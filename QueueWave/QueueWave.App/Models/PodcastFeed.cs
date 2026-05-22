using System;
using System.Collections.Generic;
namespace QueueWave.Models;

public class PodcastFeed
{
    public string         Id          { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string         Name        { get; set; } = string.Empty;
    public string         Url         { get; set; } = string.Empty;
    public string         ArtUrl      { get; set; } = string.Empty;
    public long           LastRefresh { get; set; }
    public List<FeedItem> Items       { get; set; } = [];
}