import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Calendar, Filter } from "lucide-react";

const reports = [
  {
    name: "Monthly Sales Report",
    description: "Comprehensive sales data for January 2026",
    date: "Jan 31, 2026",
    size: "2.4 MB",
    type: "PDF",
  },
  {
    name: "User Analytics Q4",
    description: "Quarterly user growth and engagement metrics",
    date: "Dec 31, 2025",
    size: "1.8 MB",
    type: "XLSX",
  },
  {
    name: "Performance Review",
    description: "System performance and uptime analysis",
    date: "Dec 15, 2025",
    size: "3.1 MB",
    type: "PDF",
  },
  {
    name: "Financial Summary",
    description: "Monthly financial breakdown and projections",
    date: "Nov 30, 2025",
    size: "1.2 MB",
    type: "XLSX",
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Reports
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            View and download business reports and analytics
          </p>
        </div>
        <Button className="gap-2">
          <Filter className="w-4 h-4" />
          Filter
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-white dark:bg-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Total Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              128
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              +12 this month
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Downloads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              1,892
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              +284 this month
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Storage Used
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              45.2 GB
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              of 100 GB
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reports List */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">
            Recent Reports
          </CardTitle>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Latest generated reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {reports.map((report, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      {report.name}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {report.description}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {report.date}
                      </span>
                      <span>•</span>
                      <span>{report.size}</span>
                      <span>•</span>
                      <Badge variant="outline" className="text-xs">
                        {report.type}
                      </Badge>
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="w-4 h-4" />
                  Download
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Generate New Report */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">
            Generate New Report
          </CardTitle>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Create custom reports on demand
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { title: "Sales Report", desc: "Generate sales analytics report" },
              {
                title: "User Report",
                desc: "Generate user growth and engagement report",
              },
              {
                title: "Financial Report",
                desc: "Generate financial summary and projections",
              },
              {
                title: "Custom Report",
                desc: "Create a custom report with filters",
              },
            ].map((report, i) => (
              <button
                key={i}
                className="p-4 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {report.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {report.desc}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
