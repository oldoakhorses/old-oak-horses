import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="panel" style={{ maxWidth: 420, margin: "40px auto" }}>
      <SignUp />
    </div>
  );
}
