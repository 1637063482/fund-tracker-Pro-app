package com.your.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 开屏主题已在 AndroidManifest 中声明，系统启动时自动渲染全屏开屏图。
        // 在 super.onCreate() 之前切回常规主题，确保 WebView 加载后不闪烁。
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);
    }
}
