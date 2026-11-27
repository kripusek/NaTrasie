package pl.natrasie.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String USER_AGENT = "NaTrasie/1.0 (Warsaw transit map)";
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 28, 41));
        if (android.os.Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                var bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                var keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
        }
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 28, 41));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setUserAgentString(webView.getSettings().getUserAgentString() + " " + USER_AGENT);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isLocal(uri)) return null;
                String path = uri.getPath();
                if ("/vehicles.pb".equals(path)) return fetchPositions();
                return asset(path);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(uri.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {
                        // Keep the map open if the system has no browser.
                    }
                }
                return true;
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        webView.loadUrl("https://" + APP_HOST + "/index.html");
    }

    private boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private WebResourceResponse asset(String path) {
        if (path == null || !path.matches("/[a-zA-Z0-9/._-]+") || path.contains("..")) {
            return error(404, "Not Found");
        }
        String type = "text/plain";
        if (path.endsWith(".html")) type = "text/html";
        if (path.endsWith(".css")) type = "text/css";
        if (path.endsWith(".js")) type = "text/javascript";
        if (path.endsWith(".png")) type = "image/png";
        try {
            return new WebResourceResponse(type, type.startsWith("text/") ? "UTF-8" : null, getAssets().open(path.substring(1)));
        } catch (IOException ignored) {
            return error(404, "Not Found");
        }
    }

    private WebResourceResponse fetchPositions() {
        HttpURLConnection connection = null;
        try {
            long bucket = System.currentTimeMillis() / 30_000;
            URL url = new URL("https://mkuran.pl/gtfs/warsaw/vehicles.pb?t=" + bucket);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setConnectTimeout(6_000);
            connection.setReadTimeout(8_000);
            if (connection.getResponseCode() != 200) return error(502, "Feed Unavailable");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (output.size() + read > 2_000_000) return error(502, "Feed Too Large");
                    output.write(buffer, 0, read);
                }
                return new WebResourceResponse("application/octet-stream", null, 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(output.toByteArray()));
            }
        } catch (IOException ignored) {
            return error(502, "Feed Unavailable");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
                Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        ((FrameLayout) webView.getParent()).removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
