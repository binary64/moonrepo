import { exec } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

export async function POST() {
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
    return NextResponse.json(
      { error: "Skip failed", details: String(error) },
      { status: 500 },
    );
  }
}
