import { exec } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

export async function POST(request: Request) {
  const skipSecret = process.env.SKIP_SECRET;
  if (!skipSecret) {
    return NextResponse.json(
      { error: "Skip endpoint not configured" },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-skip-secret");
  if (!provided || provided !== skipSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const kubectl = process.env.KUBECTL_PATH || "kubectl";
    const kubeEnv = process.env.KUBECONFIG
      ? { env: { ...process.env } }
      : { env: { ...process.env, KUBECONFIG: "/mnt/arthur/.kube/config" } };

    const getPodCmd = `${kubectl} get pods -n radio-dj -l app=liquidsoap -o jsonpath='{.items[0].metadata.name}'`;
    const { stdout: podName } = await execAsync(getPodCmd, {
      timeout: 5000,
      ...kubeEnv,
    });
    const pod = podName.trim();

    if (!pod) {
      return NextResponse.json(
        { error: "Liquidsoap pod not found" },
        { status: 503 },
      );
    }

    await execAsync(
      `${kubectl} exec -n radio-dj ${pod} -- sh -c 'echo "Arthur_Radio.skip" | nc -w1 127.0.0.1 1234'`,
      { timeout: 8000, ...kubeEnv },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Skip failed:", error);
    return NextResponse.json({ error: "Skip failed" }, { status: 500 });
  }
}
