import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import AppAuthGate from "@/components/AppAuthGate";
import GlobalFab from "@/components/GlobalFab";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HorseBilz",
  description: "Convex bill ingestion dashboard"
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
