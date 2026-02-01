import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <SignIn />
    </div>
  );
}
