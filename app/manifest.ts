import type { MetadataRoute } from "next";

// Lets Chrome and Edge install the local dashboard as an app with its own
// window and taskbar icon. The app still runs only on this computer.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Control Center",
    short_name: "Control Center",
    description: "A local dashboard for signals, newsletters, projects, and the next task to do.",
    start_url: "/?tab=today",
    scope: "/",
    display: "standalone",
    background_color: "#101411",
    theme_color: "#101411",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today", url: "/?tab=today" },
      { name: "Tasks", url: "/?tab=tasks" },
      { name: "Updates", url: "/?tab=updates" },
    ],
  };
}
