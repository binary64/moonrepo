import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact Us" };

export default function ContactUs() {
	return (
		<main className="main">
			<div className="container">
				<div className="content-box">
					<h2>Contact Us</h2>
					<div className="contact-grid">
						<div className="contact-card">
							<h3>Visit Us</h3>
							<p>
								Powerlinks
								<br />
								Unit 10
								<br />
								Hightown Industrial Estate
								<br />
								Crow Arch Lane
								<br />
								Ringwood
								<br />
								Hampshire
								<br />
								BH24 1ND
							</p>
						</div>
						<div className="contact-card">
							<h3>Telephone / Fax</h3>
							<p>
								<strong>T:</strong>{" "}
								<a href="tel:01425472100">01425 472100</a>
								<br />
								<strong>F:</strong> 01425 472123
							</p>
						</div>
						<div className="contact-card">
							<h3>Email</h3>
							<p>
								<a href="mailto:info@powerlinks.co.uk">
									info@powerlinks.co.uk
								</a>
							</p>
						</div>
					</div>
				</div>
			</div>
		</main>
	);
}
