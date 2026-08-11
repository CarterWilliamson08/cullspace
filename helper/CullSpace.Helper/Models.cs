using System.Text.Json.Serialization;

namespace CullSpace.Helper;

public sealed class IpcRequest
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("secret")]
    public string Secret { get; set; } = "";

    [JsonPropertyName("command")]
    public string Command { get; set; } = "";

    [JsonPropertyName("payload")]
    public Dictionary<string, object?>? Payload { get; set; }
}

public sealed class IpcResponse
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("result")]
    public object? Result { get; set; }

    [JsonPropertyName("progress")]
    public string? Progress { get; set; }
}

public sealed class DriveInfoDto
{
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
    public string DriveType { get; set; } = "";
    public long TotalBytes { get; set; }
    public long FreeBytes { get; set; }
    public bool IsFixed { get; set; }
}

public sealed class FileEntryDto
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public long SizeBytes { get; set; }
    public bool IsDirectory { get; set; }
}

public sealed class ScanStatsDto
{
    public long ScannedFiles { get; set; }
    public long SkippedProtected { get; set; }
    public long AccessDenied { get; set; }
}

public sealed class ScanResultDto
{
    public List<FileEntryDto> Items { get; set; } = new();
    public ScanStatsDto Stats { get; set; } = new();
}

public sealed class AppEntryDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Publisher { get; set; } = "";
    public string Version { get; set; } = "";
    public string InstallLocation { get; set; } = "";
    public string UninstallString { get; set; } = "";
    public long EstimatedSizeBytes { get; set; }
    public string Hive { get; set; } = "";
}

public sealed class RelatedPathDto
{
    public string Path { get; set; } = "";
    public long SizeBytes { get; set; }
    public string Reason { get; set; } = "";
    public bool Exists { get; set; }
    public bool Protected { get; set; }
}
