import type { NextConfig } from "next";

// Headers for every page. The Content-Security-Policy is the part that does not get in the way of Google Maps, Firebase sign-in and the deck.gl
// layers: no plugins, no <base> tricks, forms only to ourselves and no framing by other sites. A script-src policy would need 'unsafe-inline'
// for Next.js and the map loader, so it would not add protection here and is left out.
const security = [
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },   // Maps and Firebase keys are restricted by website, which needs the origin
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },   // Google sign-in opens a popup
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
