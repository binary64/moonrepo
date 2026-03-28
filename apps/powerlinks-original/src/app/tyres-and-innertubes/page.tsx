import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tyres and Innertubes" };

export default function TyresAndInnertubes() {
	return (
		<main className="main">
			<div className="container">
				<div className="content-box">
					<h2>Tyres and Innertubes</h2>
					<h3>Tyres</h3>
					<p>
						We have tyres available for most motorcycle wheels. If the tyre you
						require is not in stock every endeavour will be made to obtain it for
						you. There are usually special &quot;deals&quot; on and off during
						the year, give us a call for details.
					</p>
					<p>Fitting to loose wheels is free of charge.</p>
					<p>
						We can fit tyres on to your bike, however you will be charged for
						this service and you will need to call and arrange a convenient
						appointment.
					</p>
					<h3>Inner Tubes</h3>
					<p>Inner tubes are carried in stock.</p>
					<p>We also carry certain heavy duty inner tubes.</p>
				</div>
			</div>
		</main>
	);
}
