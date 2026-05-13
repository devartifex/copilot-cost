#!/usr/bin/env swift
import AppKit
import WebKit

final class CaptureDelegate: NSObject, WKNavigationDelegate {
    let output: String
    let width: Int
    let height: Int

    init(output: String, width: Int, height: Int) {
        self.output = output
        self.width = width
        self.height = height
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            let config = WKSnapshotConfiguration()
            config.rect = CGRect(x: 0, y: 0, width: self.width, height: self.height)
            config.snapshotWidth = NSNumber(value: self.width)
            webView.takeSnapshot(with: config) { image, error in
                if let error {
                    fputs("snapshot failed: \(error)\n", stderr)
                    exit(1)
                }
                guard
                    let image,
                    let tiff = image.tiffRepresentation,
                    let bitmap = NSBitmapImageRep(data: tiff),
                    let png = bitmap.representation(using: .png, properties: [:])
                else {
                    fputs("snapshot produced no PNG data\n", stderr)
                    exit(1)
                }
                do {
                    try png.write(to: URL(fileURLWithPath: self.output))
                    exit(0)
                } catch {
                    fputs("could not write \(self.output): \(error)\n", stderr)
                    exit(1)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("navigation failed: \(error)\n", stderr)
        exit(1)
    }
}

let args = CommandLine.arguments
guard args.count >= 3, let url = URL(string: args[1]) else {
    fputs("usage: capture-webview.swift <url> <output.png> [width] [height]\n", stderr)
    exit(2)
}

let width = Int(args.count > 3 ? args[3] : "1440") ?? 1440
let height = Int(args.count > 4 ? args[4] : "1000") ?? 1000

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let frame = CGRect(x: 0, y: 0, width: width, height: height)
let webView = WKWebView(frame: frame)
let delegate = CaptureDelegate(output: args[2], width: width, height: height)
webView.navigationDelegate = delegate
webView.load(URLRequest(url: url))

DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
    fputs("timed out waiting for \(url)\n", stderr)
    exit(1)
}

app.run()
