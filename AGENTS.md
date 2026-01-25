# AGENTS.md - Development Guidelines

This document provides guidelines for agentic coding assistants working in this monorepo.

## 🛠️ Build & Development Commands

### Moon Task Runner
All development commands use Moon as the primary task runner:

```bash
# Application development
moon run :dev          # Start Next.js dev server
moon run :build        # Build all projects
moon run :lint         # Lint with Biome (all projects)
moon run :type-check   # TypeScript type checking (all projects)

# Infrastructure
moon run pulumi:preview   # Preview Pulumi changes
moon run pulumi:up        # Deploy Pulumi infrastructure
moon run pulumi:destroy   # Destroy Pulumi infrastructure

# Pulumi bootstrap (AWS backend)
moon run pulumi-bootstrap:preview  # Preview AWS backend
moon run pulumi-bootstrap:up       # Deploy AWS backend

# Run single project tasks
moon run app:dev       # Run dev server for app only
moon run app:build     # Build app only
```

### Local Kubernetes Development
```bash
# Create local cluster and deploy all apps
bash run.sh

# Check cluster status
kubectl get nodes
kubectl get pods -A

# Access specific services
k9s  # Terminal UI for Kubernetes
```

### Testing
```bash
# Type checking (already configured in Moon)
moon run :type-check

# Linting
moon run :lint

# Run tests (when implemented)
# Note: No test framework currently configured - use patterns from existing code
```

## 🎨 Code Style Guidelines

### TypeScript/JavaScript
- **Strict TypeScript**: Enable strict mode (already configured)
- **Imports**: Use ES6 imports, organize with Biome's `organizeImports`
- **Naming**: camelCase for variables/functions, PascalCase for classes/components
- **Error Handling**: Use try/catch with proper error types, avoid generic `catch (e)`

### React/Next.js (apps/app/)
- **Components**: Use functional components with TypeScript interfaces
- **File Structure**: Follow Next.js App Router conventions
- **Styling**: Use CSS Modules (`.module.css`) as seen in existing code
- **Images**: Use Next.js `Image` component with proper optimization

### Pulumi Infrastructure (infra/pulumi/, infra/pulumi-bootstrap/)
- **Resource Naming**: Use kebab-case with `moonrepo-` prefix
- **Configuration**: Externalize config using `pulumi.Config()`
- **Outputs**: Export meaningful outputs for cross-stack references
- **Security**: Follow Cloudflare/AWS security best practices

### Kubernetes Manifests (infra/app-of-apps/, infra/manifests/)
- **Annotations**: Use `moonrepo.dev/skip-local: "true"` for resources to skip in local dev
- **Labels**: Consistent labeling for resource grouping
- **Helm Values**: Externalize configuration, use minimal overrides

## 📁 Project Structure Conventions

### Apps (apps/)
```
apps/app/
├── src/app/           # Next.js App Router pages
├── src/components/    # Reusable components (if added)
├── src/lib/          # Utilities and helpers (if added)
└── src/styles/       # Global styles (if added)
```

### Infrastructure (infra/)
```
infra/
├── pulumi/           # Cloudflare DNS & K8s secrets
├── pulumi-bootstrap/ # AWS backend setup
├── app-of-apps/      # ArgoCD Application manifests
└── manifests/        # Raw Kubernetes manifests
```

### Configuration Files
- **Moon**: `.moon/workspace.yml`, `.moon/toolchain.yml`, `moon.yml` per project
- **TypeScript**: `tsconfig.json` with strict mode enabled
- **Biome**: `biome.json` with recommended rules
- **Package Management**: `bunfig.toml`, `package.json` with workspaces

## 🔧 Tool Configuration

### Biome (Formatter & Linter)
- **Indentation**: 2 spaces
- **Line Width**: Follow Biome defaults
- **Imports**: Auto-organized by Biome
- **Rules**: Use recommended rules for Next.js and React

### TypeScript Configuration
- **Target**: ES2017
- **Strict**: true
- **Module Resolution**: bundler
- **Paths**: Configured with `@/*` alias for `./src/*`

### Git Hooks & VCS
- Biome runs on VCS-enabled files only
- Follow existing commit message patterns
- Use conventional commits when applicable

## 🚀 Development Workflow

### Adding New Features
1. **UI Components**: Add to `apps/app/src/components/` with TypeScript interfaces
2. **Pages/Routes**: Follow Next.js App Router in `apps/app/src/app/`
3. **Infrastructure**: Add Pulumi resources or ArgoCD Application manifests
4. **Local Testing**: Verify with `bash run.sh` for Kubernetes resources
5. **Linting**: Always run `moon run :lint` before committing

### Modifying Infrastructure
1. **Preview Changes**: `moon run pulumi:preview` before deployment
2. **Local Testing**: Use `moonrepo.dev/skip-local: "true"` annotation if needed
3. **State Management**: Pulumi state stored in AWS S3 (post-bootstrap)
4. **Secrets**: Use Pulumi Config or Kubernetes Secrets, never hardcode

### Error Handling Patterns
```typescript
// TypeScript/Next.js
try {
  // operation
} catch (error) {
  if (error instanceof SpecificError) {
    // handle specific error
  } else {
    // log and rethrow or handle generically
    console.error('Unexpected error:', error);
    throw new Error('Operation failed');
  }
}

// Pulumi
const resource = new SomeResource('name', {
  // config
}, { protect: true }); // Use protect for critical resources
```

## 📝 Documentation Standards

### Code Comments
- Document complex logic or non-obvious decisions
- Use JSDoc for public APIs and functions
- Avoid obvious comments (e.g., "increment i")

### README & Documentation
- Update `README.md` for significant architectural changes
- Document new environment variables or configuration
- Keep `CLAUDE.md` updated for agent instructions

### Commit Messages
- Descriptive, concise commit messages
- Reference issues or tickets when applicable
- Follow existing repository patterns

## ⚠️ Common Pitfalls & Solutions

### Tool Version Conflicts
- Use tools managed by proto (see `.prototools`)
- Never assume global tool versions
- Check `engines` in `package.json` for Node.js/Bun versions

### Local vs Production Differences
- Annotate resources with `moonrepo.dev/skip-local: "true"` when needed
- Test both local (`bash run.sh`) and production deployment paths
- Use Pulumi config for environment-specific values

### TypeScript Project References
- Moon syncs TypeScript project references automatically
- Don't manually edit `tsconfig.json` references
- Use `moon run :type-check` to verify type safety

### Kubernetes Resource Conflicts
- Check existing resources before adding new ones
- Use `kubectl get` to verify resource existence
- Follow naming conventions to avoid conflicts

## 🔍 Code Review Checklist

Before submitting changes:
- [ ] `moon run :lint` passes (no Biome errors)
- [ ] `moon run :type-check` passes (no TypeScript errors)
- [ ] Local Kubernetes deployment works (`bash run.sh`)
- [ ] Pulumi preview shows expected changes (`moon run pulumi:preview`)
- [ ] No secrets or credentials committed
- [ ] Documentation updated if needed
- [ ] Follows existing code patterns and conventions

## 📚 Additional Resources

- **Moon Documentation**: https://moonrepo.dev/docs
- **Next.js Documentation**: https://nextjs.org/docs
- **Pulumi Documentation**: https://www.pulumi.com/docs/
- **ArgoCD Documentation**: https://argo-cd.readthedocs.io/
- **Kubernetes Documentation**: https://kubernetes.io/docs/

---
*Last updated: $(date +%Y-%m-%d)*