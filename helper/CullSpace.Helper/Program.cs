using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using CullSpace.Helper;

var pipeName = GetArg("--pipe") ?? throw new InvalidOperationException("Missing --pipe");
var secret = GetArg("--secret") ?? throw new InvalidOperationException("Missing --secret");
var elevated = ArgsContain("--elevated");

Security.EnsureLogDir();
Security.Audit($"Helper start elevated={elevated} admin={Security.IsAdministrator()}");

using var server = CreatePipe(pipeName);
Console.Error.WriteLine($"READY {pipeName}");
await server.WaitForConnectionAsync();

using var reader = new StreamReader(server, Encoding.UTF8);
using var writer = new StreamWriter(server, new UTF8Encoding(false)) { AutoFlush = true };

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
};

var writeLock = new SemaphoreSlim(1, 1);

async Task WriteLockedAsync(IpcResponse response)
{
    await writeLock.WaitAsync();
    try
    {
        await WriteAsync(writer, response, jsonOptions);
    }
    finally
    {
        writeLock.Release();
    }
}

while (server.IsConnected)
{
    string? line;
    try
    {
        line = await reader.ReadLineAsync();
    }
    catch
    {
        break;
    }

    if (line is null)
        break;

    if (line.Length > 1_000_000)
    {
        await WriteLockedAsync(new IpcResponse { Id = "", Ok = false, Error = "Request too large" });
        continue;
    }

    IpcRequest? req;
    try
    {
        req = JsonSerializer.Deserialize<IpcRequest>(line, jsonOptions);
    }
    catch (Exception ex)
    {
        await WriteLockedAsync(new IpcResponse { Id = "", Ok = false, Error = $"Invalid JSON: {ex.Message}" });
        continue;
    }

    if (req is null)
    {
        await WriteLockedAsync(new IpcResponse { Id = "", Ok = false, Error = "Empty request" });
        continue;
    }

    if (!string.Equals(req.Secret, secret, StringComparison.Ordinal))
    {
        await WriteLockedAsync(new IpcResponse { Id = req.Id, Ok = false, Error = "Unauthorized" });
        continue;
    }

    var cmd = req.Command.Trim().ToLowerInvariant();
    if (IsLongRunningScan(cmd))
    {
        var captured = req;
        _ = Task.Run(async () =>
        {
            try
            {
                var progress = new Progress<string>(msg =>
                {
                    WriteLockedAsync(new IpcResponse
                    {
                        Id = captured.Id,
                        Ok = true,
                        Progress = msg,
                    }).GetAwaiter().GetResult();
                });

                var result = Handle(captured, progress);
                await WriteLockedAsync(new IpcResponse { Id = captured.Id, Ok = true, Result = result });
            }
            catch (Exception ex)
            {
                Security.Audit($"CMD fail {captured.Command}: {ex.Message}");
                await WriteLockedAsync(new IpcResponse { Id = captured.Id, Ok = false, Error = ex.Message });
            }
        });
        continue;
    }

    try
    {
        var result = Handle(req, progress: null);
        await WriteLockedAsync(new IpcResponse { Id = req.Id, Ok = true, Result = result });
    }
    catch (Exception ex)
    {
        Security.Audit($"CMD fail {req.Command}: {ex.Message}");
        await WriteLockedAsync(new IpcResponse { Id = req.Id, Ok = false, Error = ex.Message });
    }
}

static bool IsLongRunningScan(string cmd) =>
    cmd is "scan_files" or "scan_folder_files" or "scan_largest_folders";

static NamedPipeServerStream CreatePipe(string pipeName)
{
    var security = new PipeSecurity();
    var sid = WindowsIdentity.GetCurrent().User
        ?? throw new InvalidOperationException("Unable to resolve current user SID.");
    // Current user only — do not grant World/Everyone.
    security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));

    return NamedPipeServerStreamAcl.Create(
        pipeName,
        PipeDirection.InOut,
        1,
        PipeTransmissionMode.Byte,
        PipeOptions.Asynchronous,
        0,
        0,
        security);
}

static object Handle(IpcRequest req, IProgress<string>? progress)
{
    var cmd = req.Command.Trim().ToLowerInvariant();
    var payload = req.Payload ?? new Dictionary<string, object?>();

    return cmd switch
    {
        "ping" => new { pong = true, utc = DateTime.UtcNow, elevated = Security.IsAdministrator() },
        "list_drives" => Services.ListDrives(GetBool(payload, "includeNetworkOptical")),
        "scan_files" => Services.ScanLargestFiles(
            GetStringArray(payload, "drives"),
            GetInt(payload, "limit", 100),
            progress,
            GetBool(payload, "includeProgramFiles")),
        "scan_folder_files" => Services.ScanFolderFiles(
            GetString(payload, "root"),
            GetInt(payload, "limit", 100),
            progress),
        "scan_largest_folders" => Services.ScanLargestFolders(
            GetStringArray(payload, "drives"),
            GetInt(payload, "limit", 100),
            progress,
            GetBool(payload, "includeProgramFiles"),
            GetBool(payload, "dedupeDeepest")),
        "cancel_scan" => Services.RequestCancelScan(),
        "list_apps" => Services.ListInstalledApps(),
        "related_files" => Services.FindRelatedForFile(
            GetString(payload, "path"),
            GetStringArray(payload, "allowedDrives")),
        "related_app" => RelatedApp(payload),
        "delete_paths" => Services.DeletePaths(
            GetStringArray(payload, "paths"),
            GetStringArray(payload, "allowedDrives"),
            requireAdmin: true),
        "uninstall_app" => Services.StartUninstall(GetString(payload, "uninstallString")),
        "is_admin" => new { admin = Security.IsAdministrator() },
        _ => throw new InvalidOperationException($"Unknown command: {req.Command}"),
    };
}

static object RelatedApp(Dictionary<string, object?> payload)
{
    var appJson = JsonSerializer.Serialize(payload.GetValueOrDefault("app"));
    var app = JsonSerializer.Deserialize<AppEntryDto>(appJson, new JsonSerializerOptions
    {
        PropertyNameCaseInsensitive = true,
    }) ?? throw new InvalidOperationException("Missing app payload");
    return Services.FindRelatedForApp(app, GetStringArray(payload, "allowedDrives"));
}

static async Task WriteAsync(StreamWriter writer, IpcResponse response, JsonSerializerOptions options)
{
    var json = JsonSerializer.Serialize(response, options);
    await writer.WriteLineAsync(json);
}

static string? GetArg(string name)
{
    var args = Environment.GetCommandLineArgs();
    for (var i = 0; i < args.Length - 1; i++)
    {
        if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
            return args[i + 1];
    }
    return null;
}

static bool ArgsContain(string name) =>
    Environment.GetCommandLineArgs().Any(a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));

static string GetString(Dictionary<string, object?> payload, string key)
{
    if (!payload.TryGetValue(key, out var value) || value is null)
        throw new InvalidOperationException($"Missing payload.{key}");
    if (value is JsonElement je)
        return je.GetString() ?? throw new InvalidOperationException($"Invalid payload.{key}");
    return Convert.ToString(value) ?? throw new InvalidOperationException($"Invalid payload.{key}");
}

static bool GetBool(Dictionary<string, object?> payload, string key)
{
    if (!payload.TryGetValue(key, out var value) || value is null)
        return false;
    if (value is JsonElement je)
    {
        return je.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => false,
        };
    }
    return Convert.ToBoolean(value);
}

static int GetInt(Dictionary<string, object?> payload, string key, int fallback)
{
    if (!payload.TryGetValue(key, out var value) || value is null)
        return fallback;
    if (value is JsonElement je && je.TryGetInt32(out var i))
        return i;
    return Convert.ToInt32(value);
}

static string[] GetStringArray(Dictionary<string, object?> payload, string key)
{
    if (!payload.TryGetValue(key, out var value) || value is null)
        return [];
    if (value is JsonElement je)
    {
        if (je.ValueKind != JsonValueKind.Array)
            return [];
        return je.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToArray();
    }
    if (value is IEnumerable<object> objs)
        return objs.Select(o => Convert.ToString(o) ?? "").Where(s => s.Length > 0).ToArray();
    return [];
}
