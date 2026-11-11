namespace RadikalPlayers.Radikal;

public sealed class RadikalOptions
{
    public string EspBaseUrl { get; set; } = "https://esp.radikalplayers.com/";
    public string ViewerBaseUrl { get; set; } = "https://www.radikalplayers.com/";
    public string UserAgent { get; set; } =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 RadikalPlayersExperience/1.0";
    public int TimeoutSeconds { get; set; } = 35;
    public string DefaultTimezone { get; set; } = "Europe/Madrid";
    public bool UseFallbackData { get; set; } = true;
}
