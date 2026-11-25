<#
Start the local Android experience with Start-DeepTutor-Mobile.cmd.
Use -Action Stop to close the emulator and services started here.
Use -Action Build and then -Install after changing native dependencies.
For an authorized USB device, pass -Device <adb serial> -Install.
#>
param(
    [ValidateSet('Start', 'Stop', 'Build')]
    [string]$Action = 'Start',
    [ValidateRange(1024, 65535)]
    [int]$BackendPort = 8001,
    [ValidateRange(1024, 65535)]
    [int]$MetroPort = 8081,
    [string]$Device,
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$mobile = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $mobile '../..')).Path
$root = Join-Path $env:LOCALAPPDATA 'DeepTutorMobileLocal'
$stateDir = Join-Path $root 'runtime'
$avd = 'DeepTutor_Local_API34'
$consolePort = 5564
$emulatorSerial = "emulator-$consolePort"
$app = 'com.deeptutormobile'
$apk = Join-Path $mobile 'android/app/build/outputs/apk/debug/app-debug.apk'
$env:JAVA_HOME = Join-Path $root 'toolchain/jdk-17.0.21.1+2'
$env:ANDROID_HOME = Join-Path $root 'toolchain/android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_AVD_HOME = Join-Path $root 'avd'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
$adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
$emulator = Join-Path $env:ANDROID_HOME 'emulator/emulator.exe'
$expo = Join-Path $mobile 'node_modules/expo/bin/cli'
$installedBackend = Join-Path $env:APPDATA 'uv/tools/deeptutor'
$python = Join-Path $installedBackend 'Scripts/python.exe'
$node = (Get-Command node.exe).Source
$runtimeHome = $env:DEEPTUTOR_HOME
if (-not $runtimeHome) { $runtimeHome = Join-Path $env:USERPROFILE 'DeepTutor' }

New-Item -Path $stateDir -ItemType Directory -Force | Out-Null

function Invoke-Adb {
    $output = & $adb @args
    if ($LASTEXITCODE -ne 0) { throw "ADB failed ($LASTEXITCODE): $($args -join ' ')" }
    $output
}

function Get-ManagedProcess($name) {
    $record = Join-Path $stateDir "$name.json"
    if (-not (Test-Path -LiteralPath $record)) { return }
    $info = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
    if ($info.repo -ne $repo) { return }
    $process = Get-Process -Id $info.id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $info.started) {
        $process
    }
}

function Start-ManagedProcess($name, $exe, $argv, $directory, [switch]$Interactive) {
    $arguments = ($argv | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $window = if ($Interactive) { 'Normal' } else { 'Hidden' }
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $directory `
        -WindowStyle $window -RedirectStandardOutput (Join-Path $stateDir "$name.out.log") `
        -RedirectStandardError (Join-Path $stateDir "$name.err.log") -PassThru
    @{ repo = $repo; id = $process.Id; started = $process.StartTime.ToUniversalTime().Ticks.ToString() } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir "$name.json") -Encoding ascii
}

function Wait-Ready($name, $seconds, [scriptblock]$ready) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    do {
        if (& $ready) { return }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$name is not ready. Check $stateDir."
}

function Test-Http($url, [scriptblock]$validate) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        & $validate $response
    } catch { $false }
}

function Assert-PortFree($port) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop its owner or select another port."
    }
}

function Get-AvdName {
    try {
        $name = & $adb -s $emulatorSerial emu avd name 2>$null
        if ($LASTEXITCODE -eq 0) { $name | Select-Object -First 1 }
    } catch { return }
}

$lock = [System.Threading.Mutex]::new($false, 'Local\DeepTutorMobileLocalAndroid')
try {
    try { $locked = $lock.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another DeepTutor Mobile launcher is already running.' }

    if ($Action -eq 'Stop') {
        if (Get-ManagedProcess 'emulator') {
            if ((Get-AvdName) -eq $avd) { Invoke-Adb -s $emulatorSerial emu kill | Out-Host }
        }
        foreach ($name in 'metro', 'backend') {
            $process = Get-ManagedProcess $name
            if ($process) {
                & taskkill.exe /PID $process.Id /T /F | Out-Host
            }
        }
        Write-Host 'Stopped services started by this launcher.'
        return
    }

    foreach ($path in $adb, $emulator, "$env:JAVA_HOME\bin\java.exe") {
        if (-not (Test-Path -LiteralPath $path)) { throw "Missing tool: $path" }
    }

    if (-not (Test-Path -LiteralPath $expo)) {
        Push-Location $mobile
        try {
            & npm.cmd ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        } finally { Pop-Location }
    }

    if ($Action -eq 'Build' -or -not (Test-Path -LiteralPath $apk)) {
        Push-Location (Join-Path $mobile 'android')
        try {
            & .\gradlew.bat :app:assembleDebug '-PreactNativeArchitectures=x86_64,arm64-v8a' --max-workers=2 --no-daemon --console=plain
            if ($LASTEXITCODE -ne 0) { throw 'Android development build failed.' }
        } finally { Pop-Location }
        Write-Host "APK: $apk"
        if ($Action -eq 'Build') { return }
        $Install = $true
    }

    if ($BackendPort -eq $MetroPort) { throw 'Metro and the API need different ports.' }
    $authStatus = "http://127.0.0.1:$BackendPort/api/auth/status"
    $apiReady = {
        Test-Http $authStatus { param($res)
            $payload = $res.Content | ConvertFrom-Json
            $null -ne $payload.PSObject.Properties['authenticated'] -and
                $null -ne $payload.PSObject.Properties['enabled']
        }
    }
    if (& $apiReady) {
        Write-Host "Reusing DeepTutor API on $BackendPort."
    } else {
        if (-not (Get-ManagedProcess 'backend')) {
            Assert-PortFree $BackendPort
            if (-not (Test-Path -LiteralPath $python)) { throw "Missing DeepTutor Python: $python" }
            if (-not (Test-Path -LiteralPath $runtimeHome -PathType Container)) {
                throw "DeepTutor home does not exist: $runtimeHome"
            }
            $env:DEEPTUTOR_HOME = $runtimeHome
            Start-ManagedProcess 'backend' $python @(
                '-m', 'uvicorn', 'deeptutor.api.main:app', '--app-dir',
                (Join-Path $installedBackend 'Lib/site-packages'),
                '--host', '127.0.0.1', '--port', $BackendPort, '--no-access-log',
                '--no-proxy-headers', '--ws-max-size', '43341141'
            ) $runtimeHome
        }
        Wait-Ready 'DeepTutor API' 90 $apiReady
    }

    $metroStatus = "http://127.0.0.1:$MetroPort/status"
    if (-not (Get-ManagedProcess 'metro')) {
        Assert-PortFree $MetroPort
        $env:CI = $null
        $env:EXPO_OFFLINE = '1'
        $env:EXPO_NO_TELEMETRY = '1'
        Start-ManagedProcess 'metro' $node @(
            $expo, 'start', '--dev-client', '--localhost', '--port', $MetroPort, '--max-workers', '2'
        ) $mobile
    }
    Wait-Ready 'Metro' 90 {
        Test-Http $metroStatus { param($res)
            $content = $res.Content
            if ($content -is [byte[]]) { $content = [Text.Encoding]::ASCII.GetString($content) }
            $content -eq 'packager-status:running'
        }
    }

    if (-not $Device) {
        $Device = $emulatorSerial
        $runningAvd = Get-AvdName
        if ($runningAvd -and $runningAvd -ne $avd) { throw "$Device is running $runningAvd." }
        if (-not $runningAvd -and -not (Get-ManagedProcess 'emulator')) {
            Assert-PortFree $consolePort
            Assert-PortFree ($consolePort + 1)
            Start-ManagedProcess 'emulator' $emulator @(
                '-avd', $avd, '-port', $consolePort, '-gpu', 'swiftshader',
                '-no-snapshot', '-no-boot-anim'
            ) $mobile -Interactive
        }
        Wait-Ready $avd 180 {
            try { (& $adb -s $Device shell getprop sys.boot_completed 2>$null) -eq '1' }
            catch { $false }
        }
    }
    if ((Invoke-Adb -s $Device get-state) -ne 'device') { throw "$Device is not authorized and online." }
    Invoke-Adb -s $Device shell input keyevent KEYCODE_WAKEUP | Out-Null
    Invoke-Adb -s $Device shell wm dismiss-keyguard | Out-Null
    $installed = & $adb -s $Device shell pm path $app
    if ($Install -or -not ($installed -match '^package:')) {
        Invoke-Adb -s $Device install -r $apk | Out-Host
    }
    foreach ($port in $BackendPort, $MetroPort) {
        Invoke-Adb -s $Device reverse "tcp:$port" "tcp:$port" | Out-Null
    }
    $metroAddress = [uri]::EscapeDataString("http://127.0.0.1:$MetroPort")
    $deepLink = "deeptutor-mobile://expo-development-client/?url=$metroAddress"
    Invoke-Adb -s $Device shell am start -W -a android.intent.action.VIEW -d $deepLink -n "$app/.MainActivity" | Out-Host
    Write-Host "App opened. DeepTutor server address: http://127.0.0.1:$BackendPort"
    Write-Host "Logs: $stateDir"
} finally {
    if ($locked) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
