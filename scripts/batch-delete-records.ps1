<#
.SYNOPSIS
Batch delete diagnosis tasks, work orders, and maintenance cases through existing API endpoints.

.EXAMPLE
.\scripts\batch-delete-records.ps1 -TaskIds 83,84,85,86 -WorkOrderIds 41,44,45,46,47,48 -CaseIds 1,2,3

.EXAMPLE
.\scripts\batch-delete-records.ps1 -BaseUrl "http://localhost:8000" -WorkOrderIds 41,44 -Token "YOUR_TOKEN"
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$BaseUrl = "http://localhost:8000",

    [int[]]$TaskIds = @(),

    [int[]]$WorkOrderIds = @(),

    [int[]]$CaseIds = @(),

    [string]$Token = "",

    [switch]$ContinueOnError
)

$ErrorActionPreference = "Stop"

function Invoke-DeleteEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Kind,

        [Parameter(Mandatory = $true)]
        [int]$Id,

        [Parameter(Mandatory = $true)]
        [string]$Path,

        [bool]$NeedsAuth = $false
    )

    $uri = ($BaseUrl.TrimEnd("/") + $Path)
    $headers = @{}
    if ($NeedsAuth -and $Token.Trim()) {
        $headers["Authorization"] = "Bearer $($Token.Trim())"
    }

    if (-not $PSCmdlet.ShouldProcess("$Kind #$Id", "DELETE $uri")) {
        return
    }

    try {
        Invoke-WebRequest -Uri $uri -Method Delete -Headers $headers | Out-Null
        Write-Host "[OK] Deleted $Kind #$Id" -ForegroundColor Green
    }
    catch {
        $message = $_.Exception.Message
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $message = "HTTP $statusCode $message"
        }
        Write-Host "[FAIL] $Kind #$Id - $message" -ForegroundColor Red
        if (-not $ContinueOnError) {
            throw
        }
    }
}

if ($TaskIds.Count -eq 0 -and $WorkOrderIds.Count -eq 0 -and $CaseIds.Count -eq 0) {
    Write-Host "No IDs provided. Use -TaskIds, -WorkOrderIds, or -CaseIds." -ForegroundColor Yellow
    exit 0
}

foreach ($id in $TaskIds) {
    Invoke-DeleteEndpoint -Kind "task" -Id $id -Path "/api/v1/tasks/$id"
}

foreach ($id in $WorkOrderIds) {
    Invoke-DeleteEndpoint -Kind "work order" -Id $id -Path "/api/v1/maintenance/work-orders/$id" -NeedsAuth $true
}

foreach ($id in $CaseIds) {
    Invoke-DeleteEndpoint -Kind "case" -Id $id -Path "/api/v1/cases/$id"
}
