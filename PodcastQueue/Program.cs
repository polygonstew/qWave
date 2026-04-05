using System;
using System.Net.Http;
using System.Threading.Tasks;

namespace PodcastQueue
{
    class Program
    {
        static async Task Main(string[] args)
        {
            using HttpClient client = new HttpClient();
            string rssUrl = "https://feeds.megaphone.fm/stuffyoushouldknow";
            
            try
            {
                string response = await client.GetStringAsync(rssUrl);
                Console.WriteLine(response.Substring(0, 500) + "...\n");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"\nUh oh, something went wrong: {ex.Message}");
            }
        }
    }
}

