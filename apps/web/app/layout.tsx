import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LAYOUT_INIT_SCRIPT } from "@/lib/layout";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// One family for Thai + Latin so mixed-language text sets evenly.
const plexSans = IBM_Plex_Sans_Thai({
  variable: "--font-plex-sans",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DNext · LandslideWatch TH",
  description: "Landslide risk screening tool for Thailand. Not an official forecast.",
};

// viewport-fit=cover lets the layout use the notch/home-indicator area (padded with env(safe-area-inset-*)); resizes-content makes the
// on-screen keyboard shrink the layout viewport so the chat composer stays visible (browsers without support fall back to the visualViewport hook).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `${THEME_INIT_SCRIPT};${LAYOUT_INIT_SCRIPT}` }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
