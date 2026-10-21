import { useEffect, useState } from "react";
import {
	deviceAliasesChangedEvent,
	getInstallationAlias,
} from "@/lib/device-aliases";

export type DeviceInfo = {
	hostname: string;
	platform: string;
	arch: string;
};

const fallbackLabel = "This device";

export function formatDeviceLabel(info: DeviceInfo | null): string {
	if (!info?.hostname) return fallbackLabel;
	return info.hostname;
}

/** OS hostname for the current Paperite installation, including serve/web mode. */
export function useDeviceLabel(): string {
	const [info, setInfo] = useState<DeviceInfo | null>(null);
	const [alias, setAlias] = useState<string | null>(() =>
		getInstallationAlias(),
	);

	useEffect(() => {
		let cancelled = false;
		const request = window.electron?.app.getDeviceInfo
			? window.electron.app.getDeviceInfo()
			: fetch("/api/device-info").then((response) => {
					if (!response.ok) throw new Error("device info unavailable");
					return response.json() as Promise<DeviceInfo>;
				});
		void request
			.then((next) => {
				if (!cancelled && next?.hostname) setInfo(next);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const refreshAlias = () => setAlias(getInstallationAlias());
		window.addEventListener(deviceAliasesChangedEvent, refreshAlias);
		return () =>
			window.removeEventListener(deviceAliasesChangedEvent, refreshAlias);
	}, []);

	return alias || formatDeviceLabel(info);
}
