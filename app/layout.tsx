import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import AppAuthGate from "@/components/AppAuthGate";
import GlobalFab from "@/components/GlobalFab";
import "./globals.css";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-visual",
};

export const metadata: Metadata = {
  title: "Team LDK",
  description: "Team LDK management dashboard",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐴</text></svg>",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>
          <AuthProvider>
            <AppAuthGate>
              {children}
              <Suspense fallback={null}>
                <GlobalFab />
              </Suspense>
            </AppAuthGate>
          </AuthProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
