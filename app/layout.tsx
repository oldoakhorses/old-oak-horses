import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import AppAuthGate from "@/components/AppAuthGate";
import "./globals.css";

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
            <AppAuthGate>{children}</AppAuthGate>
          </AuthProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
