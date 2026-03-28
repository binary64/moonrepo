import Link from "next/link";

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

export default function Footer() {
  return (
    <footer className="x-colophon">
      <div className="container">
        <ul className="footer-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
        <p className="copyright">
          Copyright &copy; Powerlinks &diams; All Rights Reserved
        </p>
      </div>
    </footer>
  );
}
