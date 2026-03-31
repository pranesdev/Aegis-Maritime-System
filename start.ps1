$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $workspaceRoot
try {
	npm run dev
}
finally {
	Pop-Location
}
