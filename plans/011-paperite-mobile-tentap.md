# Plan 011: Build Paperite Mobile from scratch with TenTap + Expo

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: This is a new project — no drift check needed.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `288ea6b`, 2026-07-30
- **Issue**: — (not published via `--issues`)

## Why this matters

Paperite is desktop-only (Electron). The user needs notes on their phone with
full feature parity — images, checkboxes, rich text editing. The desktop app
uses TipTap (web library), which can't run natively in React Native. TenTap
(`@10play/tentap-editor`) solves this: it's a React Native rich text editor
built on Tiptap/ProseMirror, running in a WebView with native bridge extensions.
It supports images, task lists, bold/italic/underline, headings, links, code,
colors, highlights, undo/redo — everything Paperite needs.

The approach: a **new Expo React Native app** (not wrapping the Electron app)
that talks to the same Express server REST API. The server (`server/`) already
exposes `/api/workspace`, `/api/notes/*`, `/api/search`, etc. — the mobile app
becomes an alternative frontend to the same backend.

## What we're building

A standalone React Native app (Expo) with:
1. **TenTap editor** — rich text with images, checkboxes, formatting
2. **Note list / sidebar** — spaces, folders, notes tree
3. **Search** — full-text search via the server API
4. **Image capture** — camera + photo library via `expo-image-picker`
5. **Offline-ready architecture** — API layer abstracted for future local DB
6. **Dark mode** — system-aware, matches desktop theme

## Key libraries

| Library | Purpose |
|---------|---------|
| `@10play/tentap-editor` | Rich text editor (Tiptap for RN) |
| `react-native-webview` | Required by TenTap |
| `expo` (~52) | Expo SDK |
| `expo-router` | File-based routing |
| `expo-image-picker` | Camera + gallery |
| `expo-file-system` | Local file storage |
| `@react-native-async-storage/async-storage` | Key-value storage |
| `react-native-safe-area-context` | Safe area insets |
| `react-native-gesture-handler` | Swipe gestures |
| `react-native-reanimated` | Animations |
| `zustand` | Lightweight state management |

## Scope

**In scope** (new project, separate from desktop):
- New Expo project at `../paperite-mobile/` (sibling to paperite/)
- Editor screen with TenTap
- Note list screen with spaces/folders/notes
- Search screen
- Image insertion (camera + gallery)
- API client for the Express server
- Dark/light theme
- Basic navigation (list → editor)

**Out of scope** (follow-up plans):
- Offline SQLite storage (use `expo-sqlite` later)
- Yjs collaborative editing (TenTap supports it but deferred)
- Google Drive sync (deferred)
- Push notifications
- App store submission / EAS Build
- Sharing extension (iOS share sheet)
- Tablet-optimized layout

## Steps

### Step 1: Create Expo project

```bash
cd /home/iydheko/Projects
npx create-expo-app@latest paperite-mobile --template blank-typescript
cd paperite-mobile
```

**Verify**: `ls package.json` exists; `npx expo start` shows the Metro bundler

### Step 2: Install core dependencies

```bash
cd /home/iydheko/Projects/paperite-mobile
npx expo install @10play/tentap-editor react-native-webview
npx expo install expo-router expo-image-picker expo-file-system
npx expo install @react-native-async-storage/async-storage
npx expo install react-native-safe-area-context react-native-gesture-handler react-native-reanimated
npx expo install expo-status-bar expo-splash-screen
npm install zustand
```

**Verify**: `npx expo install --check` shows no version conflicts

### Step 3: Configure Expo project

Update `app.json`:

```json
{
  "expo": {
    "name": "Paperite",
    "slug": "paperite-mobile",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "paperite",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "dev.iydheko.paperite",
      "infoPlist": {
        "NSCameraUsageDescription": "Paperite needs camera access to add photos to your notes",
        "NSPhotoLibraryUsageDescription": "Paperite needs photo library access to add images to your notes"
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "dev.iydheko.paperite",
      "permissions": ["CAMERA", "READ_EXTERNAL_STORAGE"]
    },
    "plugins": ["expo-router"]
  }
}
```

Add `"main": "expo-router/entry"` to `package.json`.

**Verify**: `npx expo start --ios` or `npx expo start --android` launches without errors

### Step 4: Set up file-based routing with Expo Router

Create the directory structure:

```
app/
  _layout.tsx          # Root layout (providers, theme)
  (tabs)/
    _layout.tsx        # Tab navigator
    index.tsx          # Note list (home)
    search.tsx         # Search
  note/
    [path].tsx         # Editor screen (note path as param)
```

Create `app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { ThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="note/[path]" options={{ title: "Note", headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
```

**Verify**: `npx expo start` loads without errors; tab navigation works

### Step 5: Create the API client

Create `lib/api.ts` — a typed HTTP client for the Express server:

```typescript
const BASE_URL = "http://localhost:3000"; // Configure for your server

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export type WorkspaceNote = {
  type: "note"; title: string; path: string; preview: string;
  updatedAt: number; pinned: boolean;
};
export type WorkspaceFolder = {
  type: "folder"; title: string; path: string; children: WorkspaceItem[];
};
export type WorkspaceItem = WorkspaceNote | WorkspaceFolder;
export type WorkspaceSpace = { title: string; path: string; children: WorkspaceItem[] };
export type WorkspaceSnapshot = { rootPath: string; spaces: WorkspaceSpace[] };
export type NoteContent = { type?: string; content?: NoteContent[]; [key: string]: unknown };
export type NoteSearchResult = { path: string; title: string; preview: string; updatedAt: number; rank: number };

export const notesApi = {
  getWorkspace: () => api<WorkspaceSnapshot>("/api/workspace"),
  search: (q: string) => api<NoteSearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  readNote: (path: string) => api<NoteContent>(`/api/notes/${encodeURIComponent(path)}`),
  createNote: (parentPath: string, title: string) =>
    api("/api/notes", { method: "POST", body: JSON.stringify({ parentPath, title }) }),
  deleteItem: (path: string) =>
    api(`/api/notes/${encodeURIComponent(path)}`, { method: "DELETE" }),
};
```

**Verify**: file exists; TypeScript compiles without errors

### Step 6: Build the note list screen

Create `app/(tabs)/index.tsx` — the home screen showing spaces, folders, and notes:

```tsx
import { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, useColorScheme } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { notesApi, type WorkspaceItem, type WorkspaceSpace } from "../../lib/api";

export default function NoteListScreen() {
  const [spaces, setSpaces] = useState<WorkspaceSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const isDark = useColorScheme() === "dark";

  useEffect(() => {
    notesApi.getWorkspace().then((ws) => {
      setSpaces(ws.spaces);
      setLoading(false);
    });
  }, []);

  const renderItem = ({ item }: { item: WorkspaceItem }) => (
    <TouchableOpacity
      style={[styles.item, isDark && styles.itemDark]}
      onPress={() => {
        if (item.type === "note") {
          router.push(`/note/${encodeURIComponent(item.path)}`);
        }
      }}
    >
      <Ionicons name={item.type === "folder" ? "folder" : "document-text"} size={20} color={isDark ? "#fff" : "#333"} />
      <View style={styles.itemText}>
        <Text style={[styles.title, isDark && styles.titleDark]}>{item.title}</Text>
        {item.type === "note" && <Text style={[styles.preview, isDark && styles.previewDark]} numberOfLines={1}>{item.preview}</Text>}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {spaces.map((space) => (
        <View key={space.path}>
          <Text style={[styles.spaceTitle, isDark && styles.spaceTitleDark]}>{space.title}</Text>
          <FlatList data={space.children} renderItem={renderItem} keyExtractor={(i) => i.path} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  containerDark: { backgroundColor: "#1a1a1a" },
  spaceTitle: { fontSize: 13, fontWeight: "600", color: "#666", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  spaceTitleDark: { color: "#999" },
  item: { flexDirection: "row", alignItems: "center", padding: 12, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e0e0e0" },
  itemDark: { borderBottomColor: "#333" },
  itemText: { flex: 1 },
  title: { fontSize: 16, color: "#000" },
  titleDark: { color: "#fff" },
  preview: { fontSize: 13, color: "#666", marginTop: 2 },
  previewDark: { color: "#888" },
});
```

**Verify**: `npx expo start` shows the note list (may be empty if server isn't running)

### Step 7: Build the editor screen with TenTap

Create `app/note/[path].tsx` — the core editor:

```tsx
import { useEffect, useState } from "react";
import { View, StyleSheet, useColorScheme, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { RichText, Toolbar, useEditorBridge, BoldBridge, ItalicBridge, UnderlineBridge, StrikeBridge, HeadingBridge, BulletListBridge, OrderedListBridge, TaskListBridge, ImageBridge, LinkBridge, ColorBridge, HighlightBridge, CodeBridge, PlaceholderBridge } from "@10play/tentap-editor";
import { notesApi, type NoteContent } from "../../lib/api";

const bridgeExtensions = [
  BoldBridge,
  ItalicBridge,
  UnderlineBridge,
  StrikeBridge,
  HeadingBridge.configureExtension({ levels: [1, 2, 3] }),
  BulletListBridge,
  OrderedListBridge,
  TaskListBridge,
  ImageBridge,
  LinkBridge,
  ColorBridge,
  HighlightBridge,
  CodeBridge,
  PlaceholderBridge.configureExtension({ placeholder: "Start writing..." }),
];

export default function NoteEditorScreen() {
  const { path } = useLocalSearchParams<{ path: string }>();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const isDark = useColorScheme() === "dark";
  const router = useRouter();

  const editor = useEditorBridge({
    autofocus: true,
    avoidIosKeyboard: true,
    bridgeExtensions,
    initialContent: content,
    onChange: () => {
      // Debounced save would go here
    },
  });

  useEffect(() => {
    if (path) {
      notesApi.readNote(decodeURIComponent(path)).then((note) => {
        // Convert TipTap JSON to HTML for TenTap
        const html = tipTapJsonToHtml(note);
        setContent(html);
        setLoading(false);
      });
    }
  }, [path]);

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={["top"]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        {/* Back button, title, etc */}
      </View>
      <RichText editor={editor} style={[styles.editor, isDark && styles.editorDark]} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.toolbarContainer}
      >
        <Toolbar editor={editor} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Helper to convert TipTap JSON to HTML for TenTap
function tipTapJsonToHtml(note: NoteContent): string {
  if (!note.content) return "";
  return note.content.map(nodeToHtml).join("");
}

function nodeToHtml(node: NoteContent): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "bold") text = `<strong>${text}</strong>`;
        if (mark.type === "italic") text = `<em>${text}</em>`;
        if (mark.type === "underline") text = `<u>${text}</u>`;
        if (mark.type === "strike") text = `<s>${text}</s>`;
        if (mark.type === "code") text = `<code>${text}</code>`;
      }
    }
    return text;
  }
  if (node.type === "paragraph") {
    const inner = (node.content ?? []).map(nodeToHtml).join("");
    return `<p>${inner}</p>`;
  }
  if (node.type === "heading") {
    const level = node.attrs?.level ?? 1;
    const inner = (node.content ?? []).map(nodeToHtml).join("");
    return `<h${level}>${inner}</h${level}>`;
  }
  if (node.type === "bulletList") {
    return `<ul>${(node.content ?? []).map(nodeToHtml).join("")}</ul>`;
  }
  if (node.type === "orderedList") {
    return `<ol>${(node.content ?? []).map(nodeToHtml).join("")}</ol>`;
  }
  if (node.type === "listItem") {
    return `<li>${(node.content ?? []).map(nodeToHtml).join("")}</li>`;
  }
  if (node.type === "taskList") {
    return `<ul data-type="taskList">${(node.content ?? []).map(nodeToHtml).join("")}</ul>`;
  }
  if (node.type === "taskItem") {
    const checked = node.attrs?.checked ? "checked" : "";
    return `<li data-type="taskItem" data-checked="${checked}">${(node.content ?? []).map(nodeToHtml).join("")}</li>`;
  }
  if (node.type === "blockquote") {
    return `<blockquote>${(node.content ?? []).map(nodeToHtml).join("")}</blockquote>`;
  }
  if (node.type === "codeBlock") {
    return `<pre><code>${(node.content ?? []).map(nodeToHtml).join("")}</code></pre>`;
  }
  if (node.type === "image") {
    return `<img src="${node.attrs?.src}" alt="${node.attrs?.alt ?? ""}" />`;
  }
  if (node.type === "horizontalRule") {
    return "<hr />";
  }
  return (node.content ?? []).map(nodeToHtml).join("");
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  containerDark: { backgroundColor: "#1a1a1a" },
  header: { height: 44, justifyContent: "center", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e0e0e0" },
  headerDark: { borderBottomColor: "#333" },
  editor: { flex: 1 },
  editorDark: { backgroundColor: "#1a1a1a" },
  toolbarContainer: { width: "100%", position: "absolute", bottom: 0 },
});
```

**Verify**: `npx expo start` loads; editor renders with toolbar; text can be typed

### Step 8: Add image insertion via expo-image-picker

In the editor screen, add image insertion that uses the device camera or photo library:

```typescript
import * as ImagePicker from "expo-image-picker";

async function insertImage(editor: ReturnType<typeof useEditorBridge>) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.8,
  });
  if (!result.canceled && result.assets[0]) {
    editor.commands.setImage({ src: result.assets[0].uri });
  }
}

async function insertImageFromCamera(editor: ReturnType<typeof useEditorBridge>) {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return;
  const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
  if (!result.canceled && result.assets[0]) {
    editor.commands.setImage({ src: result.assets[0].uri });
  }
}
```

Wire these into a custom toolbar button or action sheet in the editor.

**Verify**: can pick image from gallery and see it in the editor

### Step 9: Build search screen

Create `app/(tabs)/search.tsx`:

```tsx
import { useState } from "react";
import { View, TextInput, FlatList, Text, TouchableOpacity, StyleSheet, useColorScheme } from "react-native";
import { useRouter } from "expo-router";
import { notesApi, type NoteSearchResult } from "../../lib/api";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const router = useRouter();
  const isDark = useColorScheme() === "dark";

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    const res = await notesApi.search(q);
    setResults(res);
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="Search notes..."
        placeholderTextColor={isDark ? "#888" : "#999"}
        value={query}
        onChangeText={handleSearch}
        autoFocus
      />
      <FlatList
        data={results}
        keyExtractor={(i) => i.path}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.result, isDark && styles.resultDark]}
            onPress={() => router.push(`/note/${encodeURIComponent(item.path)}`)}
          >
            <Text style={[styles.resultTitle, isDark && styles.resultTitleDark]}>{item.title}</Text>
            <Text style={[styles.resultPreview, isDark && styles.resultPreviewDark]} numberOfLines={2}>{item.preview}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  containerDark: { backgroundColor: "#1a1a1a" },
  input: { height: 48, margin: 12, padding: 12, borderRadius: 8, backgroundColor: "#f0f0f0", fontSize: 16 },
  inputDark: { backgroundColor: "#2a2a2a", color: "#fff" },
  result: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e0e0e0" },
  resultDark: { borderBottomColor: "#333" },
  resultTitle: { fontSize: 16, fontWeight: "500", color: "#000" },
  resultTitleDark: { color: "#fff" },
  resultPreview: { fontSize: 13, color: "#666", marginTop: 4 },
  resultPreviewDark: { color: "#888" },
});
```

**Verify**: search input appears; typing triggers API calls (if server is running)

### Step 10: Tab navigation layout

Create `app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "react-native";

export default function TabLayout() {
  const isDark = useColorScheme() === "dark";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#007AFF",
        tabBarStyle: { backgroundColor: isDark ? "#1a1a1a" : "#fff" },
        headerStyle: { backgroundColor: isDark ? "#1a1a1a" : "#fff" },
        headerTintColor: isDark ? "#fff" : "#000",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Notes",
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
```

**Verify**: two tabs appear at bottom; switching between Notes and Search works

### Step 11: Add dark mode theme support

Use `useColorScheme()` consistently throughout the app. TenTap supports custom themes — create a theme file:

```typescript
// lib/theme.ts
import { type EditorTheme } from "@10play/tentap-editor";

export const darkTheme: EditorTheme = {
  toolbar: {
    toolbarContainer: { backgroundColor: "#2a2a2a" },
    iconButton: { color: "#fff" },
    activeButton: { backgroundColor: "#007AFF" },
  },
};

export const lightTheme: EditorTheme = {
  toolbar: {
    toolbarContainer: { backgroundColor: "#f8f8f8" },
    iconButton: { color: "#000" },
    activeButton: { backgroundColor: "#007AFF" },
  },
};
```

Pass the appropriate theme to `useEditorBridge({ theme: isDark ? darkTheme : lightTheme })`.

**Verify**: toggle system dark mode; app UI and editor toolbar follow

### Step 12: Wire up create/delete note actions

Add a FAB (floating action button) on the note list to create a new note, and swipe-to-delete or long-press context menu:

```typescript
// In the note list screen
const handleCreateNote = async () => {
  const result = await notesApi.createNote("/", "Untitled");
  router.push(`/note/${encodeURIComponent(result.path)}`);
};
```

**Verify**: tapping FAB creates a note and navigates to editor

### Step 13: Configure API URL

Create a settings mechanism. For MVP, hardcode the server URL or use a simple config:

```typescript
// lib/config.ts
export const API_BASE_URL = "http://YOUR_SERVER_IP:3000";
```

For local dev with Expo on a physical device, use your computer's local IP (not `localhost`).

**Verify**: app loads data from the running Express server

### Step 14: Final integration test

1. Start the Express server: `cd /home/iydheko/Projects/paperite && bun run web`
2. Start the Expo app: `cd /home/iydheko/Projects/paperite-mobile && npx expo start`
3. Open on device/simulator
4. Verify: notes list loads from server, can tap note → editor opens with TenTap, text is editable, checkboxes toggle, images can be inserted from gallery, search works, dark mode toggles

**Verify**: all features listed above work end-to-end

## Test plan

- **Unit**: `npx expo start` without errors
- **Editor**: TenTap renders; can type, format bold/italic, toggle checkboxes, insert images
- **Navigation**: tab switching works; tapping note → editor; back button returns to list
- **API**: note list loads from server; search returns results; create note works
- **Theme**: dark mode follows system setting
- **Platform**: test on iOS simulator (macOS required) and Android emulator

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx expo start` exits 0 (no errors)
- [ ] `npx tsc --noEmit` exits 0 (if tsconfig is set up)
- [ ] `app/(tabs)/index.tsx` renders note list
- [ ] `app/note/[path].tsx` renders TenTap editor with toolbar
- [ ] `lib/api.ts` exists and implements all required API calls
- [ ] Image insertion works via expo-image-picker
- [ ] Search screen queries the server
- [ ] Dark mode works via useColorScheme
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- TenTap fails to render in the Expo environment (WebView compatibility issue).
- The Express server API responses don't match the types defined in `lib/api.ts`.
- `expo-image-picker` can't access the camera/gallery on the target platform.
- The app crashes on startup due to a native module linking issue.

## Maintenance notes

- **Content format**: The desktop app stores notes as TipTap JSON. The mobile
  editor uses TenTap which is also TipTap-based but expects HTML input. The
  `tipTapJsonToHtml()` converter in Step 7 handles this. A reverse converter
  (HTML → TipTap JSON) is needed for saving — follow-up plan.
- **Server URL**: Currently hardcoded. A follow-up should add a settings screen
  where users enter their server IP/port.
- **Offline**: Currently requires the server to be running. A follow-up should
  add `expo-sqlite` for local note storage.
- **Image upload**: Currently inserts images as local URIs. A follow-up should
  upload images to the server's `assets/` directory and store the relative path.
- **Yjs sync**: TenTap supports Yjs collaboration but it's deferred. The desktop
  app uses Yjs for real-time sync — this should be added later for cross-device
  editing.
- **Codebase**: This is a **separate project** at `../paperite-mobile/`. It does
  NOT share code with the Electron desktop app. The only shared contract is the
  Express server REST API.
