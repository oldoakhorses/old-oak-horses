import type { Metadata } from "next";
import Link from "next/link";
import {
  ClerkProvider,
  SignInButton,
  SignOutButton,
  SignedIn,
  SignedOut,
  UserButton
} from "@clerk/nextjs";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "HorseBilz",
  description: "Convex bill ingestion dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <ConvexClientProvider>
            <header className="container" style={{ paddingBottom: 8 }}>
              <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <nav style={{ display: "flex", gap: 14 }}>
                  <Link href="/dashboard">Dashboard</Link>
                  <Link href="/upload">Upload</Link>
                  <Link href="/reports">Reports</Link>
                  <Link href="/veterinary">Veterinary</Link>
                </nav>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <SignedOut>
                    <SignInButton>
                      <button type="button">Sign in</button>
                    </SignInButton>
                  </SignedOut>
                  <SignedIn>
                    <UserButton />
                    <SignOutButton>
                      <button type="button" className="secondary">
                        Sign out
                      </button>
                    </SignOutButton>
                  </SignedIn>
                </div>
              </div>
            </header>
            <main className="container">{children}</main>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
