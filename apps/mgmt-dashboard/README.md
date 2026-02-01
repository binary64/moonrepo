# Management Dashboard

A modern, secure internal business dashboard built with Next.js 16, Tailwind CSS, Clerk authentication, and shadcn/ui.

## Features

- 🚀 **Next.js 16** with App Router for optimal performance
- 🎨 **Tailwind CSS** for responsive, modern styling
- 🔐 **Clerk Authentication** - secure, modern auth with email/password
- 📱 **Responsive Design** - works perfectly on mobile, tablet, and desktop
- 🎯 **shadcn/ui Components** - beautiful, accessible UI components
- 🌙 **Dark Mode Support** - automatic theme detection
- 📊 **Dashboard Sections**:
  - Overview with key metrics and activity
  - Reports with download capabilities
  - Settings for profile, notifications, and security

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Authentication**: Clerk
- **TypeScript**: Full type safety
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 22.x or higher
- Bun (recommended) or npm/yarn
- A Clerk account (free at clerk.com)

### Installation

1. **Clone the repository** (if not already in the monorepo)
   ```bash
   cd ~/repos/moonrepo/apps/mgmt-dashboard
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up Clerk**

   Create a new Clerk application at [clerk.com](https://clerk.com):
   - Sign up/login to Clerk
   - Create a new application
   - Copy your Publishable Key and Secret Key
   - Configure allowed redirect URLs in Clerk dashboard:
     - Development: `http://localhost:3000`
     - Add `/sign-in` and `/sign-up` as allowed redirect URLs

4. **Create environment file**

   Create a `.env.local` file in the project root:

   ```bash
   cp .env.local.example .env.local
   ```

   Then fill in your Clerk credentials:

   ```env
   # Clerk Authentication
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx
   CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxx

   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
   ```

5. **Run the development server**

   ```bash
   moon run :dev
   ```

   Or from the monorepo root:
   ```bash
   moon run mgmt-dashboard:dev
   ```

6. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

## Project Structure

```
mgmt-dashboard/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/
│   │   │   └── page.tsx      # Sign-in page with Clerk
│   │   └── sign-up/
│   │       └── page.tsx      # Sign-up page with Clerk
│   ├── (dashboard)/
│   │   ├── layout.tsx        # Dashboard layout with sidebar
│   │   ├── page.tsx          # Overview page
│   │   ├── reports/
│   │   │   └── page.tsx      # Reports page
│   │   └── settings/
│   │       └── page.tsx      # Settings page
│   ├── layout.tsx            # Root layout with ClerkProvider
│   └── page.tsx              # Landing page
├── components/
│   └── ui/                   # shadcn/ui components
├── lib/
│   └── utils.ts              # Utility functions
├── middleware.ts             # Clerk middleware for route protection
└── public/                   # Static assets
```

## Available Scripts

- `moon run :dev` - Start development server
- `moon run :build` - Build for production
- `moon run :start` - Start production server
- `moon run :lint` - Run linter

You can also run these from the monorepo root:
- `moon run mgmt-dashboard:dev`
- `moon run mgmt-dashboard:build`
- `moon run mgmt-dashboard:lint`

## Authentication

This app uses Clerk for authentication. The auth flow:

1. Unauthenticated users see the landing page
2. Sign in/up takes users to Clerk-hosted auth pages
3. After authentication, users are redirected to `/dashboard`
4. Protected routes are guarded by middleware
5. User button in sidebar allows sign-out

### Protected Routes

All routes under `/dashboard` are protected and require authentication. Unauthenticated users are automatically redirected to `/sign-in`.

## Customization

### Adding New Dashboard Pages

1. Create a new folder in `app/(dashboard)/`
2. Add a `page.tsx` file
3. Update navigation in `app/(dashboard)/layout.tsx`

### Adding UI Components

```bash
bunx shadcn@latest add [component-name]
```

Example:
```bash
bunx shadcn@latest add dialog
```

Note: This uses `bunx` directly as shadcn CLI is not integrated with Moon. After adding components, run `moon run :lint` to ensure code style compliance.

### Styling

- Global styles: `app/globals.css`
- Tailwind config: `tailwind.config.ts`
- Theme variables: Defined in globals.css using CSS variables

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | Yes |
| `CLERK_SECRET_KEY` | Clerk secret key | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Sign-in page path | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Sign-up page path | Yes |

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

### Other Platforms

This app can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- AWS Amplify
- DigitalOcean App Platform

## Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## License

MIT

## Support

For issues and questions:
- Check the [Next.js docs](https://nextjs.org/docs)
- Check [Clerk docs](https://clerk.com/docs)
- Check [shadcn/ui docs](https://ui.shadcn.com)

---

Built with ❤️ using Next.js, Clerk, and shadcn/ui
