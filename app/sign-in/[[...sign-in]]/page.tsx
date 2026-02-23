import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="panel" style={{ maxWidth: 420, margin: "40px auto" }}>
      <SignIn />
    </div>
  );
}
