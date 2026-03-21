import { getServerSession, type NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "authentik",
      name: "Authentik",
      type: "oauth",
      wellKnown: `${process.env.AUTHENTIK_ISSUER ?? (() => { throw new Error("AUTHENTIK_ISSUER is not set") })()}/.well-known/openid-configuration`,
      clientId: process.env.AUTHENTIK_CLIENT_ID,
      clientSecret: process.env.AUTHENTIK_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
      idToken: true,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    },
  ],
  pages: {
    signIn: "/sign-in",
  },
};

export function getSession() {
  return getServerSession(authOptions);
}
