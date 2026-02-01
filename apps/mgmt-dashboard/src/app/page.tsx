import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BarChart3,
  Shield,
  Zap,
  Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 dark:text-white mb-6">
            Management Dashboard
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-8">
            Powerful internal tools to manage your business with ease
          </p>
          <div className="flex gap-4 justify-center">
            <Button
              asChild
              size="lg"
              className="gap-2"
            >
              <a href="/sign-in">
                Sign In
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="gap-2"
            >
              <a href="/sign-up">
                Get Started
              </a>
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-0 shadow-lg">
            <CardHeader>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-gray-900 dark:text-white">
                Analytics
              </CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-400">
                Track your business metrics with real-time analytics
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-0 shadow-lg">
            <CardHeader>
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-gray-900 dark:text-white">
                Secure
              </CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-400">
                Enterprise-grade security with Clerk authentication
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-0 shadow-lg">
            <CardHeader>
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle className="text-gray-900 dark:text-white">
                Fast
              </CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-400">
                Built with Next.js 16 for optimal performance
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Benefits */}
        <div className="mt-24 max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white text-center mb-12">
            Why Choose Us?
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {[
              {
                icon: Users,
                title: "User Management",
                desc: "Easily manage users, roles, and permissions",
              },
              {
                icon: BarChart3,
                title: "Real-time Reports",
                desc: "Generate reports on-demand with live data",
              },
              {
                icon: Shield,
                title: "Secure by Default",
                desc: "All routes protected with authentication",
              },
              {
                icon: Zap,
                title: "Modern Tech Stack",
                desc: "Built with Next.js, Tailwind, and shadcn/ui",
              },
            ].map((benefit, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                    <benefit.icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                    {benefit.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {benefit.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-8 text-gray-600 dark:text-gray-400">
        <p>© 2026 Management Dashboard. All rights reserved.</p>
      </footer>
    </div>
  );
}
