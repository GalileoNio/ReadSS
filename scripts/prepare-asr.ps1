param(
    [string]$Target,
    [string]$Cache
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Target) { $Target = Join-Path $root 'build\bin\asr' }
if (-not $Cache) { $Cache = Join-Path $root '.toolchain\asr' }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$downloads = Join-Path $Cache 'downloads'
$extract = Join-Path $Cache 'extract'
New-Item -ItemType Directory -Force -Path $downloads, $extract | Out-Null

function Get-Download {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Name,
        [string]$FallbackUrl
    )

    $path = Join-Path $downloads $Name
    if ((Test-Path $path) -and (Get-Item $path).Length -gt 0) {
        return $path
    }

    $partial = "$path.part"
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    foreach ($candidate in @($Url, $FallbackUrl)) {
        if (-not $candidate) { continue }
        Remove-Item $partial -Force -ErrorAction SilentlyContinue
        Write-Host "downloading $Name"
        if ($curl) {
            & $curl.Source -L --fail --retry 2 --connect-timeout 30 --output $partial $candidate
            if ($LASTEXITCODE -ne 0) { continue }
        } else {
            try {
                Invoke-WebRequest -UseBasicParsing -Uri $candidate -OutFile $partial
            } catch {
                continue
            }
        }
        Move-Item -Force $partial $path
        return $path
    }
    throw "downloading $Name failed from every source"
}

function Expand-ZipFresh {
    param(
        [Parameter(Mandatory)][string]$Archive,
        [Parameter(Mandatory)][string]$Name
    )

    $destination = Join-Path $extract $Name
    Remove-Item $destination -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -Path $Archive -DestinationPath $destination
    return $destination
}

function Expand-TarFresh {
    param(
        [Parameter(Mandatory)][string]$Archive,
        [Parameter(Mandatory)][string]$Name
    )

    $destination = Join-Path $extract $Name
    Remove-Item $destination -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tar)) {
        $tar = (Get-Command tar.exe -ErrorAction Stop).Source
    }
    & $tar -xjf $Archive -C $destination
    if ($LASTEXITCODE -ne 0) {
        throw "extracting $Archive failed (exit code $LASTEXITCODE)"
    }
    return $destination
}

$whisperUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip'
$whisperModelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin'
$ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip'
$sherpaUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts.tar.bz2'
$segmentationUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'
$embeddingUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'

$whisperArchive = Get-Download $whisperUrl 'whisper-bin-x64-v1.9.0.zip'
$whisperModel = Get-Download $whisperModelUrl 'ggml-base-q5_1.bin' 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin'
$ffmpegArchive = Get-Download $ffmpegUrl 'ffmpeg-master-latest-win64-lgpl-shared.zip'
$sherpaArchive = Get-Download $sherpaUrl 'sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts.tar.bz2'
$segmentationArchive = Get-Download $segmentationUrl 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'
$embeddingModel = Get-Download $embeddingUrl '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'
$whisperLicense = Get-Download 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.0/LICENSE' 'whisper.cpp-LICENSE.txt'
$whisperModelLicense = Get-Download 'https://raw.githubusercontent.com/openai/whisper/main/LICENSE' 'Whisper-model-LICENSE.txt'
$sherpaLicense = Get-Download 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v1.13.8/LICENSE' 'sherpa-onnx-LICENSE.txt'
$pyannoteLicense = Get-Download 'https://raw.githubusercontent.com/pyannote/pyannote-audio/develop/LICENSE' 'pyannote-LICENSE.txt'
$threeDSpeakerLicense = Get-Download 'https://raw.githubusercontent.com/modelscope/3D-Speaker/main/LICENSE' '3D-Speaker-LICENSE.txt'
$ffmpegLicense = Get-Download 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.LGPLv2.1' 'FFmpeg-COPYING.LGPLv2.1.txt'

$whisperFiles = Expand-ZipFresh $whisperArchive 'whisper'
$ffmpegFiles = Expand-ZipFresh $ffmpegArchive 'ffmpeg'
$sherpaFiles = Expand-TarFresh $sherpaArchive 'sherpa'
$segmentationFiles = Expand-TarFresh $segmentationArchive 'segmentation'

$whisperExe = Get-ChildItem $whisperFiles -Recurse -File -Filter 'whisper-cli.exe' | Select-Object -First 1
$ffmpegExe = Get-ChildItem $ffmpegFiles -Recurse -File -Filter 'ffmpeg.exe' | Select-Object -First 1
$sherpaExe = Get-ChildItem $sherpaFiles -Recurse -File -Filter 'sherpa-onnx-offline-speaker-diarization.exe' | Select-Object -First 1
$segmentationModel = Get-ChildItem $segmentationFiles -Recurse -File -Filter '*.onnx' |
    Where-Object { $_.FullName -match 'segmentation' -and $_.Name -notmatch 'int8' } |
    Select-Object -First 1
foreach ($required in @($whisperExe, $ffmpegExe, $sherpaExe, $segmentationModel)) {
    if (-not $required) { throw 'A required ASR runtime file was not found after extraction' }
}

$stage = Join-Path (Split-Path -Parent $Target) ".asr-stage-$PID"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
$whisperTarget = Join-Path $stage 'whisper'
$ffmpegTarget = Join-Path $stage 'ffmpeg'
$sherpaTarget = Join-Path $stage 'sherpa'
$modelsTarget = Join-Path $stage 'models'
$licensesTarget = Join-Path $stage 'licenses'
New-Item -ItemType Directory -Force -Path $whisperTarget, $ffmpegTarget, $sherpaTarget, $modelsTarget, $licensesTarget | Out-Null

Copy-Item (Join-Path $whisperExe.Directory.FullName '*') $whisperTarget -Recurse -Force
Copy-Item $ffmpegExe.FullName $ffmpegTarget -Force
Get-ChildItem $ffmpegExe.Directory.FullName -File -Filter '*.dll' | Copy-Item -Destination $ffmpegTarget -Force
Copy-Item $sherpaExe.FullName $sherpaTarget -Force
Copy-Item $whisperModel (Join-Path $modelsTarget 'ggml-base-q5_1.bin') -Force
Copy-Item $segmentationModel.FullName (Join-Path $modelsTarget 'pyannote-segmentation-3.0.onnx') -Force
Copy-Item $embeddingModel (Join-Path $modelsTarget '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx') -Force
Copy-Item $whisperLicense, $whisperModelLicense, $sherpaLicense, $pyannoteLicense, $threeDSpeakerLicense, $ffmpegLicense $licensesTarget -Force

$notice = @"
ReadS local transcription runtime

whisper.cpp v1.9.0 (MIT)
$whisperUrl

Whisper base-q5_1 multilingual model (MIT)
$whisperModelUrl

FFmpeg Windows x64 LGPL shared build
$ffmpegUrl

sherpa-onnx v1.13.8 (Apache-2.0)
$sherpaUrl

pyannote segmentation 3.0 converted for sherpa-onnx (MIT)
$segmentationUrl

3D-Speaker ERes2Net Chinese speaker embedding model (Apache-2.0)
$embeddingUrl

License texts for the executable components are in the licenses directory.
Model terms and attribution remain available from the source URLs above.
"@
Set-Content -Path (Join-Path $stage 'THIRD_PARTY_NOTICES.txt') -Value $notice -Encoding UTF8

$stageRoot = [IO.Path]::GetFullPath($stage).TrimEnd('\')
$manifestFiles = Get-ChildItem $stage -Recurse -File | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
        size = $_.Length
        sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifest = [ordered]@{
    format = 1
    architecture = 'windows-x64'
    whisper = 'v1.9.0'
    whisperModel = 'base-q5_1-multilingual'
    sherpaOnnx = 'v1.13.8'
    files = @($manifestFiles)
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $stage 'manifest.json') -Encoding UTF8

Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue
Move-Item $stage $Target
$size = (Get-ChildItem $Target -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("prepared {0} ({1:N1} MiB)" -f $Target, ($size / 1MB))
