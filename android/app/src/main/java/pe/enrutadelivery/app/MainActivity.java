package pe.enrutadelivery.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final String PREFS = "enruta";
    private static final String KEY_URL = "web_url";
    private static final int FILE_CHOOSER_REQUEST = 4101;

    private WebView webView;
    private ProgressBar progress;
    private View errorView;
    private TextView errorDetail;
    private ValueCallback<Uri[]> filePathCallback;
    private String currentUrl;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        progress = findViewById(R.id.progress);
        errorView = findViewById(R.id.errorView);
        errorDetail = findViewById(R.id.errorDetail);

        configurarWebView();

        findViewById(R.id.retryBtn).setOnClickListener(v -> cargar(currentUrl));
        findViewById(R.id.configBtn).setOnClickListener(v -> mostrarDialogoUrl());

        currentUrl = obtenerUrl();
        cargar(currentUrl);
    }

    private void configurarWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " EnRutaApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        }
        webView.setBackgroundColor(0xFFFFFFFF);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setSupportMultipleWindows(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return manejarUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return manejarUrl(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progress.setVisibility(View.VISIBLE);
                errorView.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                currentUrl = url;
                // window.open no existe como ventana en la app: abrimos el enlace
                // en la misma vista para que WhatsApp se abra con un Intent.
                view.evaluateJavascript(
                        "(function(){window.open=function(u){if(u){window.location.href=u;}return null;};})();",
                        null);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    mostrarError("No se pudo cargar la página. Revisa tu conexión a internet.");
                }
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.equals(view.getUrl())) {
                    mostrarError("No se pudo cargar la página. Revisa tu conexión a internet.");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                if (newProgress >= 100) progress.setVisibility(View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(Intent.createChooser(intent, "Selecciona una imagen o PDF"), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "No hay una app para elegir archivos.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
    }

    private boolean manejarUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) {
            abrirExterno(uri);
            return true;
        }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (host.equals("wa.me") || host.endsWith(".wa.me")
                || host.equals("api.whatsapp.com") || host.endsWith(".whatsapp.com")
                || host.equals("whatsapp.com")
                || host.equals("instagram.com") || host.equals("www.instagram.com")
                || host.equals("tiktok.com") || host.equals("www.tiktok.com")
                || host.equals("facebook.com") || host.equals("www.facebook.com")
                || host.equals("maps.google.com") || host.equals("www.google.com")
                || host.equals("goo.gl") || host.equals("maps.app.goo.gl")) {
            abrirExterno(uri);
            return true;
        }
        return false;
    }

    private void abrirExterno(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay una app instalada para abrir este enlace.", Toast.LENGTH_LONG).show();
        }
    }

    private String obtenerUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return normalizarUrl(prefs.getString(KEY_URL, BuildConfig.WEB_URL));
    }

    private String normalizarUrl(String url) {
        String u = url == null ? "" : url.trim();
        if (u.isEmpty()) u = BuildConfig.WEB_URL;
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
        return u;
    }

    private void cargar(String url) {
        currentUrl = normalizarUrl(url);
        errorView.setVisibility(View.GONE);
        progress.setVisibility(View.VISIBLE);
        progress.setProgress(0);
        webView.loadUrl(currentUrl);
    }

    private void mostrarError(String mensaje) {
        progress.setVisibility(View.GONE);
        errorDetail.setText(mensaje);
        errorView.setVisibility(View.VISIBLE);
    }

    private void mostrarDialogoUrl() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(obtenerUrl());
        input.setSelectAllOnFocus(true);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        FrameLayout cont = new FrameLayout(this);
        cont.setPadding(pad, pad / 2, pad, 0);
        cont.addView(input, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        new AlertDialog.Builder(this)
                .setTitle("Dirección de la web")
                .setMessage("Escribe la URL pública de EnRuta Delivery. Ejemplo: https://enrutadelivery.com/")
                .setView(cont)
                .setPositiveButton("Guardar", (d, w) -> {
                    String url = normalizarUrl(input.getText().toString());
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
                    cargar(url);
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
