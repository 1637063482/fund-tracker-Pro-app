$file = "C:\Users\王豪6207.KEYLIGHTS\fund-tracker-pro\src\components\Chat\PortfolioChat.jsx"
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

$changes = @()

# 1. handleOpen: add setIsChatClosing(false)
$old1 = 'setShowButton(false);`r`n    open();'
$new1 = 'setShowButton(false);`r`n    setIsChatClosing(false);`r`n    open();'
if ($content -match [regex]::Escape($old1)) {
    $content = $content -replace [regex]::Escape($old1), $new1
    $changes += "OK: handleOpen"
} else { $changes += "FAIL: handleOpen" }

# 2. handleClose: add setShowAiParams(false) + setIsChatClosing(true)
$old2 = 'setShowButton(true);`r`n    animClose();'
$new2 = 'setShowButton(true);`r`n    setShowAiParams(false);`r`n    setIsChatClosing(true);`r`n    animClose();'
if ($content -match [regex]::Escape($old2)) {
    $content = $content -replace [regex]::Escape($old2), $new2
    $changes += "OK: handleClose"
} else { $changes += "FAIL: handleClose" }

# 3. Add state variables
$old3 = 'const [showAiParams, setShowAiParams] = useState(false);`r`n  const [confirmAction, setConfirmAction] = useState(null);'
$new3 = 'const [showAiParams, setShowAiParams] = useState(false);`r`n  const [aiParamsTriggerRect, setAiParamsTriggerRect] = useState(null);`r`n  const [isChatClosing, setIsChatClosing] = useState(false);`r`n  const [confirmAction, setConfirmAction] = useState(null);'
if ($content -match [regex]::Escape($old3)) {
    $content = $content -replace [regex]::Escape($old3), $new3
    $changes += "OK: states"
} else { $changes += "FAIL: states" }

# 4. Overlay div: add className
$old4 = '<div style={overlayStyle} onClick={handleClose}>'
$new4 = '<div style={overlayStyle} onClick={handleClose} className={isChatClosing ? "pointer-events-none" : ""}>'
if ($content -match [regex]::Escape($old4)) {
    $content = $content -replace [regex]::Escape($old4), $new4
    $changes += "OK: overlay className"
} else { $changes += "FAIL: overlay className" }

# 5. Gear button onClick
$old5 = 'onClick={() => setShowAiParams(!showAiParams)} className={'
$new5 = 'onClick={(e) => { setAiParamsTriggerRect(e.currentTarget.getBoundingClientRect()); setShowAiParams(!showAiParams); }} className={'
if ($content -match [regex]::Escape($old5)) {
    $content = $content -replace [regex]::Escape($old5), $new5
    $changes += "OK: gear button onClick"
} else { $changes += "FAIL: gear button onClick" }

$changes