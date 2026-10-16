# Starts Control Center automatically when you sign in to Windows.
#
#   npm run autostart:install   register the sign-in task
#   npm run autostart:status    show whether it is registered and running
#   npm run autostart:remove    remove the sign-in task
#
# The task runs scripts\windows\start-hidden.vbs for the current user only, with
# normal (not administrator) rights, 30 seconds after sign-in. The dashboard
# still listens only on 127.0.0.1. Output goes to logs\launch.log.
param(
  [ValidateSet("install", "remove", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$TaskName = "Control Center"
$Launcher = Join-Path $PSScriptRoot "start-hidden.vbs"
$User = "$env:USERDOMAIN\$env:USERNAME"

function Get-DashboardHealth {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 3
    return $response.status
  } catch {
    return "not running"
  }
}

switch ($Action) {
  "install" {
    if (-not (Test-Path $Launcher)) { throw "Missing launcher: $Launcher" }
    $taskAction = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//B //Nologo `"$Launcher`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
    $trigger.Delay = "PT30S"
    # No time limit: the default would stop the dashboard after three days.
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings `
      -Principal $principal -Force `
      -Description "Starts the local Control Center dashboard at sign-in (http://127.0.0.1:3000)." | Out-Null
    Write-Output "Installed: Control Center will start 30 seconds after you sign in."
    Write-Output "Start it now without signing out: Start-ScheduledTask -TaskName `"$TaskName`""
  }
  "remove" {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Output "Removed the sign-in task. A dashboard that is already running keeps running until you sign out."
    } else {
      Write-Output "No sign-in task is registered."
    }
  }
  "status" {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      $info = Get-ScheduledTaskInfo -TaskName $TaskName
      # The task only starts a hidden launcher, so its result is 0 even when the
      # dashboard fails to start; the health check below is the real signal.
      Write-Output "Sign-in task: registered; last ran $($info.LastRunTime)"
      $target = ($task.Actions[0].Arguments -replace '^.*"([^"]+)".*$', '$1')
      if (-not (Test-Path $target)) {
        Write-Output "Warning: the task points at $target, which no longer exists. Run npm run autostart:install again from the new folder."
      }
    } else {
      Write-Output "Sign-in task: not registered"
    }
    $health = Get-DashboardHealth
    Write-Output "Dashboard: $health"
    $log = Join-Path (Split-Path (Split-Path $PSScriptRoot)) "logs\launch.log"
    if ($health -ne "ready" -and (Test-Path $log)) {
      Write-Output "Last lines of logs\launch.log:"
      Get-Content $log -Tail 8
    }
  }
}
