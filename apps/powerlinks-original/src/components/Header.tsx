"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/sprockets", label: "Sprockets" },
  { href: "/parts-and-spares", label: "Parts & Spares" },
  { href: "/chain-guide-and-kit-prices", label: "Chains" },
  { href: "/batteries", label: "Batteries" },
  { href: "/tyres-and-innertubes", label: "Tyres and Tubes" },
  { href: "/servicing-and-mots", label: "Servicing" },
  { href: "/terms-of-business", label: "Business Terms" },
  { href: "/contact-us", label: "Contact Us" },
];

/**
 * Site-wide header with logo and responsive navigation menu.
 * Highlights the active route and exposes a mobile toggle with full ARIA support.
 */
export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div className="logobar">
        <Link href="/">
          <Image
            src="/images/powerlinks_logo.png"
            alt="Powerlinks"
            width={300}
            height={95}
            priority
            style={{ height: "auto" }}
          />
        </Link>
      </div>
      <nav className="navbar">
        <div className="navbar-inner">
          <button
            type="button"
            className="nav-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Navigation"
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
          >
            ☰ Navigation
          </button>
          <ul
            id="primary-navigation"
            className={`nav-list ${menuOpen ? "open" : ""}`}
          >
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={pathname === item.href ? "active" : ""}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}
