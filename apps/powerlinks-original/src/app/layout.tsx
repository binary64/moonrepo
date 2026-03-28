import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
	title: {
		default: "Powerlinks - Motorcycle Parts and Servicing",
		template: "%s | Powerlinks",
	},
	description:
		"Come to Powerlinks to source parts and spares for most makes of motorbike at our unit in Ringwood in Hampshire.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en-GB">
			<body>
				<Header />
				{children}
				<Footer />
			</body>
		</html>
	);
}
