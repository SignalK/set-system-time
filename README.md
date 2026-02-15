# set-system-time
Signal K Node server plugin to set system time on time data from GPS
<br>

![UI image](https://i.imgur.com/K0IZQxG.png "UI image")
<br>
<br>

# Configuration Interface
###  Use sudo when setting the time :
When this option is checked, **set-system-time plugin** will try to use `sudo` to set the date. 
It's required that sudo have a password-less access to the `date` command.


To give `sudo` a no password access only to the `date` command, you can add the following line to your sudoers file : 
```
pi ALL=(ALL) NOPASSWD: /bin/date
```
 --- *In this example, **pi** is the username that run the signalk server. Yours could be different.*

Sudo is not available in Signal K Server image, but setting time should work without it with the latest Docker image.

# Docker
The plugin needs enough privileges to run `date -s`. In containers this usually means either:
- passwordless `sudo` for `date`, or
- setting the setuid bit on the `date` binary inside the image.
- adding the `SYS_TIME` capability to the container.

Below is a minimal docker compose snippet using inline Dockerfile to enable setuid for `date`:
```yaml
services:
	signalk:
		build:
			context: .
			dockerfile_inline: |
				FROM signalk/signalk-server:latest
				RUN if [ -x /usr/bin/date ]; then chmod u+s /usr/bin/date; fi \
						&& if [ -x /bin/date ]; then chmod u+s /bin/date; fi
		ports:
			- "3000:3000"
```

Alternative without sudo or setuid (capability-based):
```yaml
services:
	signalk:
		image: signalk/signalk-server:latest
		cap_add:
			- SYS_TIME
```
