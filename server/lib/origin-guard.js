// Cross-origin protection for a local, unauthenticated server.
//
// `paperite serve` binds to loopback and has no authentication of its own.
// "Loopback only" is NOT a security boundary against a browser: a page on
// https://evil.example.com can issue requests to http://127.0.0.1:3000, and
// those requests arrive from 127.0.0.1. The browser then decides whether the
// attacker may read the response — which is governed by CORS.
//
// With `Access-Control-Allow-Origin: *`, any site may read the response.
// So a hostile page could lift the desktop's Clerk identity and a valid
// Convex JWT straight out of the user's browser, and could read or rewrite
// notes.
//
// The fix is to reject requests that a browser considers cross-site, and to
// reject requests whose Host header is not a loopback name (which is what
// DNS rebinding looks like: evil.example.com resolving to 127.0.0.1).
//
// Non-browser clients (the Electron main process, the mobile app, curl) send
// no Origin header, and are unaffected.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True when the host is a loopback IP or "localhost". */
const isLoopbackHost = (hostname) => {
	if (!hostname) return false;
	const host = hostname.toLowerCase();
	if (LOOPBACK_HOSTNAMES.has(host)) return true;
	// 127.0.0.0/8 and ::ffff:127.0.0.1 mapped addresses.
	if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
	return false;
};

/** Strip the port and brackets from an origin or host value. */
const hostnameOf = (value) => {
	if (!value) return "";
	const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
	const host = withoutScheme.split("/")[0].split("?")[0];
	// Drop the port, but keep IPv6 brackets intact.
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end === -1 ? host : host.slice(0, end + 1);
	}
	const colon = host.lastIndexOf(":");
	return colon === -1 ? host : host.slice(0, colon);
};

/**
 * True when a browser request to this server may read the response.
 *
 * - `Sec-Fetch-Site` is the browser's own verdict. "same-origin" and
 *   "same-site" are fine (same registrable domain). "cross-site" and
 *   "none" are not — except "none", which the browser sends for
 *   user-initiated navigations, and which we still gate on Origin/Host.
 * - `Origin` is set on cross-origin writes and on some reads. If present, it
 *   must be a loopback origin or explicitly allowlisted.
 * - `Host` must be a loopback name. This is what stops DNS rebinding, where
 *   an attacker's domain resolves to 127.0.0.1 and the browser sends
 *   `Host: evil.example.com`.
 *
 * `allowedOrigins` is the operator's explicit opt-in list. An allowlisted
 * origin is trusted for CORS *and* for this check — otherwise the two
 * policies would contradict each other.
 */
const isSameSiteRequest = (headers, allowedOrigins = []) => {
	const allowed = new Set(
		allowedOrigins
			.map((origin) => String(origin).trim().replace(/\/+$/, ""))
			.filter(Boolean),
	);
	const origin = typeof headers.origin === "string" ? headers.origin : "";
	const normalizedOrigin = origin.replace(/\/+$/, "");
	const isAllowlisted =
		normalizedOrigin !== "" && allowed.has(normalizedOrigin);

	// "null" is an opaque origin (sandboxed iframe, file://, some
	// redirects). It is never a legitimate caller of a loopback server.
	if (origin === "null") return false;

	const fetchSite = headers["sec-fetch-site"];
	if (
		typeof fetchSite === "string" &&
		fetchSite !== "" &&
		fetchSite !== "same-origin" &&
		fetchSite !== "same-site" &&
		fetchSite !== "none" &&
		!isAllowlisted
	) {
		return false;
	}

	if (origin !== "" && !isAllowlisted) {
		if (!isLoopbackHost(hostnameOf(origin))) return false;
	}

	// The Host check always applies, even for an allowlisted origin: a
	// rebound host is what DNS rebinding looks like, and no allowlist
	// entry should be able to opt out of it.
	const host = headers.host;
	if (typeof host === "string" && host !== "") {
		if (!isLoopbackHost(hostnameOf(host))) return false;
	}

	return true;
};

/**
 * Build the CORS options for the server.
 *
 * Origins are never reflected blindly — only an explicit allowlist is
 * echoed, and `*` is never used, because a wildcard would let any site read
 * an authenticated response.
 *
 * The `origin` callback must receive a boolean (or a string/regex), NOT an
 * options object: `cors` treats any truthy value as "allowed" and then
 * reflects the request origin.
 */
const createCorsOptions = (allowedOrigins = []) => {
	const allowed = new Set(
		allowedOrigins
			.map((origin) => String(origin).trim().replace(/\/+$/, ""))
			.filter(Boolean),
	);
	return {
		origin(origin, callback) {
			if (!origin) {
				// No Origin header — a non-browser client. Allow, but do not
				// emit an ACAO header.
				callback(null, false);
				return;
			}
			const normalized = origin.replace(/\/+$/, "");
			callback(null, allowed.has(normalized) ? normalized : false);
		},
		credentials: true,
	};
};

module.exports = {
	isLoopbackHost,
	hostnameOf,
	isSameSiteRequest,
	createCorsOptions,
};
