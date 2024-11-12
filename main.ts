import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.48/deno-dom-wasm.ts";
import { BatchQueue } from "https://deno.land/x/batch_queue@v0.0.1/mod.ts";
import { MultiProgressBar } from "https://deno.land/x/progress@v1.2.8/mod.ts";

async function getFuckingFastLink(downloadUrl: string) {
	const headers = new Headers({
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
	});
	const response = await fetch(downloadUrl, { headers });
	const responseText = await response.text();
	const doc = new DOMParser().parseFromString(responseText, "text/html");
	const scripts = doc?.querySelectorAll("script");
	const pattern = /https:\/\/fuckingfast.co\/dl\/[a-zA-Z0-9_-]+/;
	for (const script of scripts || []) {
		const match = pattern.exec(script.textContent || "");
		if (match) {
			return new Request(match[0], {
				headers: new Headers({
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
					"Referer": downloadUrl,
				}),
			});
		}
	}

	throw new Error("Download link not found");
}

async function getDataNodesLink(downloadUrl: string) {
	const url = new URL(downloadUrl);
	const pathSegments = url.pathname.split("/");
	const fileCode = pathSegments[1];
	const fileName = pathSegments[pathSegments.length - 1];
	const headers = new Headers({
		"Content-Type": "application/x-www-form-urlencoded",
		"Cookie": `lang=english; file_name=${fileName}; file_code=${fileCode};`,
		"Host": "datanodes.to",
		"Origin": "https://datanodes.to",
		"Referer": "https://datanodes.to/download",
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
	});
	const body = new URLSearchParams({
		"op": "download2",
		"id": fileCode,
		"rand": "",
		"referer": "https://datanodes.to/download",
		"method_free": "Free Download >>",
		"method_premium": "",
		"adblock_detected": "",
	});
	const response = await fetch("https://datanodes.to/download", {
		method: "POST",
		body,
		headers,
		redirect: "manual",
	});
	if (response.status === 302) {
		const location = response.headers.get("Location");
		if (location) {
			return new Request(location, {
				headers: new Headers({
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
					"Referer": "https://datanodes.to/download",
				}),
			});
		}
	}

	throw new Error("Download link not found");
}

function processLinks(urls: string[]) {
	return Promise.all(urls.map(url => {
		const parsedUrl = new URL(url.trim());
		if (parsedUrl.hostname.includes("fuckingfast.co")) {
			return getFuckingFastLink(url.trim());
		} else if (parsedUrl.hostname.includes("datanodes.to")) {
			return getDataNodesLink(url.trim());
		}
	}).filter(x => !!x));
}

type Progress = {
	readonly completed: number;
	readonly total: number;
	readonly text: string;
}

class PartialProgressBar extends MultiProgressBar {
	last: Progress[] = [];

	renderSpecific(index: number, value: Progress) {
		const current = [...this.last];
		current[index] = value;
		this.last = Array.from(current, (value, index) => value || {
			completed: 100,
			total: 100,
			text: `undefined#${index}`,
		});
		return this.render(this.last);
	}
}

function downloadFile(request: Request, progressBars: PartialProgressBar, index: number) {
	const fileName = request.url.split('/').pop() || 'file';

	return async () => {
		try {
			const stats = await Deno.stat(fileName).catch(() => null);

			if (stats) {
				progressBars.renderSpecific(index, {
					completed: stats.size,
					total: stats.size,
					text: fileName,
				});
				return;
			}

			const response = await fetch(request);
			if (!response.ok || !response.body) {
				console.log(`[!] Failed to download: ${request}`);
				return;
			}

			const contentLength = +response.headers.get("Content-Length")!;
			let receivedLength = 0;

			const file = await Deno.open(fileName, { create: true, write: true });
			await response.body.pipeThrough(new TransformStream({
				transform(chunk, controller) {
					receivedLength += chunk.length;
					progressBars.renderSpecific(index, {
						completed: receivedLength,
						total: contentLength,
						text: fileName,
					});
					controller.enqueue(chunk);
				},
			})).pipeTo(file.writable);
			file.close();
		} catch (error) {
			console.log(`[!] Error downloading ${request.url}:`, error);
		}
	};
}

const linksFile = "links.txt";
const outputFile = "output_links.txt";

const urls = (await Deno.readTextFile(linksFile)).split("\n").filter(Boolean);

const downloadLinks = await processLinks(urls);

console.log("[*] Done generating download links!");

if (confirm('Do you want to download the files?')) {
	console.log("[*] Starting downloading the files...");

	const progressBars = new PartialProgressBar({
		title: "Downloading files",
	});

	const batch = new BatchQueue(3);
	batch.queue(...downloadLinks.map((downloadLink, i) => downloadFile(downloadLink, progressBars, i)));

	await batch.run();
} else {
	console.log("[*] Created download links...");
	const output = downloadLinks.filter(Boolean).map(el => el.url).join("\n");
	await Deno.writeTextFile(outputFile, output + "\n", { append: false });
}
