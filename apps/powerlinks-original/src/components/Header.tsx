"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
	{ href: "/", label: "Home" },
	{ href: "/sprockets", label: "Sprockets" },
	{ href: "/parts-and-spares", label: "Parts & Spares" },
	{ href: "/chain-guide-and-kit-prices", label: "Chains" },
	{ href: "/batteries", label: "Batteries" },
	{ href: "/tyres-and-innertubes", label: "Tyres & Tubes" },
	{ href: "/servicing-and-mots", label: "Servicing" },
	{ href: "/terms-of-business", label: "Terms" },
	{ href: "/contact-us", label: "Contact" },
];

export default function Header() {
	const pathname = usePathname();
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<header className="header">
			<div className="header-inner">
				<Link href="/" className="logo">
					POWER<span>LINKS</span>
				</Link>
				<button
					type="button"
					className="menu-toggle"
					onClick={() => setMenuOpen(!menuOpen)}
					aria-label="Toggle navigation"
				>
					{menuOpen ? "✕" : "☰"}
				</button>
				<nav className={`nav ${menuOpen ? "open" : ""}`}>
					{NAV_ITEMS.map((item) => (
						<Link
							key={item.href}
							href={item.href}
							className={pathname === item.href ? "active" : ""}
							onClick={() => setMenuOpen(false)}
						>
							{item.label}
						</Link>
					))}
				</nav>
			</div>
		</header>
	);
}
