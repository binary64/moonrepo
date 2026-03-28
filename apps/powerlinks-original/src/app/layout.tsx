import type { Metadata } from "next";
import { Lato } from "next/font/google";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import "./globals.css";

const lato = Lato({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Powerlinks - Motorcycle Parts and Servicing",
    template: "%s - Powerlinks",
  },
  description:
    "Come to Powerlinks to source parts and spares for most makes of motorbike at our unit in Ringwood in Hampshire.",
};

/**
 * Root document layout shared across all routes.
 * Wraps every page with the site Header and Footer.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" className={lato.className}>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
