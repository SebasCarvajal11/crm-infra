using System;
using System.Diagnostics;
using System.IO;

namespace CimaCrmLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            string appDir = @"D:\BACKUP CELULAR OLIMPO";
            string scriptPath = Path.Combine(appDir, "start-local.ps1");
            
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\" -Interactive";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = true;

            try
            {
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error: " + ex.Message);
            }
        }
    }
}
