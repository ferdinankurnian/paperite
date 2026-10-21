import { afterEach, expect, test } from "bun:test";
import { PersonalServerHttpProvider } from "@/lib/personal-server-provider";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("personal-server provider uses Web API base64 at the JSON boundary", async () => {
	const requests: Request[] = [];
	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		if (request.url.endsWith("/snapshot")) {
			const body = (await request.json()) as {
				data: string;
				stateVector: string;
			};
			expect(body).toEqual({ data: "AP8B", stateVector: "AgE=" });
			return Response.json({
				spaceId: "space-1",
				noteId: "note-1",
				data: body.data,
				stateVector: body.stateVector,
				updatedAt: "2026-10-19T00:00:00.000Z",
			});
		}
		const body = (await request.json()) as {
			updateBatchId: string;
			deviceId: string;
			updates: string[];
		};
		expect(body).toEqual({
			updateBatchId: "update-1",
			deviceId: "device-1",
			updates: ["AAE="],
		});
		return Response.json({
			spaceId: "space-1",
			noteId: "note-1",
			updateBatchId: body.updateBatchId,
			deviceId: body.deviceId,
			updates: body.updates,
			createdAt: "2026-10-19T00:00:01.000Z",
		});
	};

	const provider = new PersonalServerHttpProvider({
		endpoint: "http://localhost:3210",
		serverId: "server-1",
		deviceId: "device-1",
		deviceCredential: "credential-only-in-memory",
	});
	const snapshot = await provider.writeSnapshot({
		spaceId: "space-1",
		noteId: "note-1",
		data: new Uint8Array([0, 255, 1]),
		stateVector: new Uint8Array([2, 1]),
	});
	const batch = await provider.appendUpdateBatch({
		spaceId: "space-1",
		noteId: "note-1",
		updateBatchId: "update-1",
		deviceId: "device-1",
		updates: [new Uint8Array([0, 1])],
	});

	expect([...snapshot.data]).toEqual([0, 255, 1]);
	expect([...snapshot.stateVector]).toEqual([2, 1]);
	expect([...batch.updates[0]!]).toEqual([0, 1]);
	expect(requests).toHaveLength(2);
	expect(requests[0]?.headers.get("authorization")).toBe(
		"Bearer credential-only-in-memory",
	);
});
