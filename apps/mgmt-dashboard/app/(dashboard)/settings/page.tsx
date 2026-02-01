import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { User, Bell, Shield, Palette } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          Settings
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Manage your account settings and preferences
        </p>
      </div>

      {/* Profile Settings */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="w-5 h-5" />
            <CardTitle className="text-gray-900 dark:text-white">
              Profile Settings
            </CardTitle>
          </div>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Update your profile information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900 dark:text-white">
                First Name
              </label>
              <Input placeholder="John" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900 dark:text-white">
                Last Name
              </label>
              <Input placeholder="Doe" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-900 dark:text-white">
              Email
            </label>
            <Input type="email" placeholder="john@example.com" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-900 dark:text-white">
              Bio
            </label>
            <Input placeholder="Tell us about yourself" />
          </div>
          <Button>Save Changes</Button>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            <CardTitle className="text-gray-900 dark:text-white">
              Notifications
            </CardTitle>
          </div>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Manage your notification preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            {
              title: "Email Notifications",
              desc: "Receive email updates about your account",
            },
            {
              title: "Push Notifications",
              desc: "Receive push notifications on your devices",
            },
            {
              title: "Weekly Reports",
              desc: "Get weekly summary reports via email",
            },
            {
              title: "Security Alerts",
              desc: "Receive alerts about security events",
            },
          ].map((setting, i) => (
            <div key={i} className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {setting.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {setting.desc}
                </p>
              </div>
              <div className="h-6 w-11 rounded-full bg-blue-600 relative cursor-pointer">
                <div className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <CardTitle className="text-gray-900 dark:text-white">
              Security
            </CardTitle>
          </div>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Manage your security settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">
              Change Password
            </h3>
            <div className="space-y-2">
              <Input type="password" placeholder="Current password" />
              <Input type="password" placeholder="New password" />
              <Input type="password" placeholder="Confirm new password" />
            </div>
            <Button className="mt-4">Update Password</Button>
          </div>

          <Separator />

          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">
              Two-Factor Authentication
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Add an extra layer of security to your account
            </p>
            <Button variant="outline">Enable 2FA</Button>
          </div>
        </CardContent>
      </Card>

      {/* Appearance Settings */}
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            <CardTitle className="text-gray-900 dark:text-white">
              Appearance
            </CardTitle>
          </div>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Customize the look and feel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                Theme
              </label>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1">
                  Light
                </Button>
                <Button variant="outline" className="flex-1">
                  Dark
                </Button>
                <Button className="flex-1">System</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="bg-white dark:bg-gray-800 border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="text-red-600 dark:text-red-400">
            Danger Zone
          </CardTitle>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            Irreversible and destructive actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">
                Delete Account
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Permanently delete your account and all data
              </p>
            </div>
            <Button variant="destructive">Delete Account</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
