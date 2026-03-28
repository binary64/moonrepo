import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = { title: "Chain Guide and Kit Prices" };

export default function Chains() {
	return (
		<main className="main">
			<div className="container">
				<div className="content-box">
					<h2>Chain Guide and Kit Prices</h2>
					<Image
						src="/images/chain.jpg"
						alt="Motorcycle drive chain"
						width={400}
						height={460}
						style={{ width: "100%", maxWidth: 300, height: "auto", borderRadius: 8, float: "right", marginLeft: "1rem", marginBottom: "1rem" }}
					/>
					<p>
						Our stock of drive chains covers a range of makes and prices. It is
						vital that the correct chain is fitted to your motorbike. Below is a
						rough guide to the chains that we can supply.
					</p>
					<h3>DID Chain</h3>
					<p>
						A top quality drive chain. The range includes 415, 428, 520, 525,
						530, 532 and 630. These are all available in either:
					</p>
					<ul>
						<li>standard/heavy duty VX grade</li>
						<li>standard/heavy duty VX grade gold</li>
						<li>
							extra heavy duty ZVMX grade with &apos;O&apos; ring and
							&apos;X&apos; ring variations
						</li>
					</ul>
					<h3>JT Chain</h3>
					<p>415 to 530X1R. Prices and availability on request.</p>
					<p>
						<strong>NB:</strong> We cannot be held responsible for you fitting an
						incorrect chain and/or sprockets.
					</p>
				</div>
			</div>
		</main>
	);
}
