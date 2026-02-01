import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  DollarSign,
  TrendingUp,
  Activity,
} from "lucide-react";

const stats = [
  {
    title: "Total Revenue",
    value: "$45,231.89",
    change: "+20.1% from last month",
    icon: DollarSign,
  },
  {
    title: "Active Users",
    value: "2,350",
    change: "+180 from last month",
    icon: Users,
  },
  {
    title: "Growth Rate",
    value: "12.5%",
    change: "+2.4% from last month",
    icon: TrendingUp,
  },
  {
    title: "Active Sessions",
    value: "573",
    change: "+201 since last hour",
    icon: Activity,
  },
];

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          Overview
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Welcome back! Here's what's happening with your business today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="bg-white dark:bg-gray-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {stat.value}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {stat.change}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">
            Recent Activity
          </CardTitle>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Latest updates and changes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              {
                action: "New user registered",
                time: "2 minutes ago",
                status: "success",
              },
              {
                action: "Payment received",
                time: "15 minutes ago",
                status: "success",
              },
              {
                action: "Server alert resolved",
                time: "1 hour ago",
                status: "warning",
              },
              {
                action: "Database backup completed",
                time: "3 hours ago",
                status: "success",
              },
            ].map((activity, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {activity.action}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {activity.time}
                  </p>
                </div>
                <Badge
                  variant={
                    activity.status === "success" ? "default" : "secondary"
                  }
                  className={
                    activity.status === "success"
                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                      : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                  }
                >
                  {activity.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">
            Quick Actions
          </CardTitle>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Common tasks and operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { title: "Generate Report", desc: "Create monthly analytics" },
              { title: "Add User", desc: "Invite team member" },
              { title: "View Logs", desc: "System activity logs" },
            ].map((action, i) => (
              <button
                key={i}
                className="p-4 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {action.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {action.desc}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
