using Avalonia.Controls;

namespace QueueWave.Views;

public partial class BlackoutWindow : Window
{
    public BlackoutWindow()
    {
        InitializeComponent();
        PointerPressed += (_, _) => Close();
        KeyDown        += (_, _) => Close();
    }
}