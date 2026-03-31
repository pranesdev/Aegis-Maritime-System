$Dashboard = if ($args.Count -gt 0) { $args[0] } else { "next" }

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $scriptsDir

Push-Location $workspaceRoot
try {
	switch ($Dashboard.ToLowerInvariant()) {
		"next" { npm run start:next; break }
		"vite" { npm run start:vite; break }
		"all" { npm run start:all; break }
		default {
			Write-Host "Unknown dashboard option '$Dashboard'. Use: next, vite, or all."
			exit 1
		}
	}
}
finally {
	Pop-Location
}
