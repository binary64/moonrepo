import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = { title: "Sprockets" };

export default function Sprockets() {
	return (
		<main className="main">
			<div className="container">
				<div className="content-box">
					<h2>Sprockets</h2>
					<Image
						src="/images/sprockets.jpg"
						alt="Motorcycle sprockets available at Powerlinks"
						width={600}
						height={346}
						style={{ width: "100%", maxWidth: 500, height: "auto", borderRadius: 8, marginBottom: "1rem" }}
					/>
					<p>
						There are a huge number of sprockets manufactured and so therefore
						we cannot list them all here.
					</p>
					<p>
						We can supply you (in most cases) with sprockets to increase your
						acceleration, e.g. less teeth on the gearbox sprocket, or to give
						you faster top end, e.g. less teeth on the rear sprocket. These are
						all individual tastes and we can discuss them either in person or on
						the telephone.
					</p>
					<p>
						We keep a wide variety of sprockets in stock. The most popular are
						steel as they are harder wearing and less expensive than the
						aluminium ones. Should we for some reason not have your particular
						sprocket in stock, it can normally be obtained and delivered to you
						within a very few days.
					</p>
					<p>
						For availability, prices and advice please{" "}
						<a href="/contact-us">contact us</a>; we will always endeavour to
						give you the best prices we can.
					</p>
				</div>
			</div>
		</main>
	);
}
