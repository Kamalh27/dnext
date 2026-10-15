"use client";

import { Component, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** If Google Maps fails while drawing (a blocked key, no network), only the map area shows a message; the chat, tables and report keep working. */
export class MapBoundary extends Component<{ lang: Lang; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("map failed:", error.message); }
  render() {
    if (!this.state.failed) return this.props.children;
    const tr = t(this.props.lang);
    return (
      <div role="alert" data-testid="map-failed" className="flex h-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center">
        <p className="font-medium">{tr.mapFailed}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{tr.mapFailedHint}</p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="min-h-9 rounded-md border bg-background px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11">{tr.retry}</button>
      </div>
    );
  }
}
