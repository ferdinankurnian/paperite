#!/bin/sh
# paperite launcher for tarball installs (and quick local runs).
#
#   ./paperite.sh              launch the Electron desktop app
#   ./paperite.sh serve ...    headless server, UI in a browser
#
# Resolves the bundled Electron binary next to this script, or honors
# $PAPERITE_BIN. AUR packages install an equivalent symlink as
# /usr/bin/paperite — this script is only for raw tarballs.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -n "${PAPERITE_BIN:-}" ]; then
	bin="$PAPERITE_BIN"
elif [ -x "$here/paperite" ]; then
	bin="$here/paperite"
else
	# electron-builder tarballs / unpacked dirs: pick the executable sibling
	bin=""
	for candidate in "$here"/*.AppImage "$here"/paperite-*; do
		if [ -x "$candidate" ] && [ -f "$candidate" ]; then
			bin="$candidate"
			break
		fi
	done
	if [ -z "$bin" ]; then
		echo "paperite: no bundled Electron binary found next to $0" >&2
		echo "paperite: set PAPERITE_BIN to the AppImage or electron binary" >&2
		exit 1
	fi
fi

exec "$bin" "$@"
