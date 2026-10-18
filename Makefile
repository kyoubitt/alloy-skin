# make          build the loader (shim/alloyskin.so)
# make install  build, then link everything into place:
#                 ~/.local/lib/alloy-skin/   loader + alloy-skinned launcher
#                 ~/.config/alloy-skin/      skin css/js
LIB    := $(HOME)/.local/lib/alloy-skin
CONF   := $(HOME)/.config/alloy-skin
CFLAGS := -shared -fPIC -O2 -Wall -Wextra -Wno-unused-parameter $(shell pkg-config --cflags gio-2.0)

shim/alloyskin.so: shim/alloyskin.c shim/bridge.c
	gcc $(CFLAGS) -Wl,-z,lazy -o $@ $^ -ldl -lm
	@# the loader is preloaded into every child process; GLib data symbols would break plain programs like sed
	@! objdump -R $@ | grep -v 'JUMP_SLOT\|RELATIVE' | grep -q ' g_' || (echo "uses a GLib data symbol" && rm $@ && false)

install: shim/alloyskin.so
	mkdir -p $(LIB) $(CONF)
	cp shim/alloyskin.so $(LIB)/alloyskin.so
	ln -sf $(CURDIR)/shim/alloy-skinned $(LIB)/alloy-skinned
	for f in skin/*.css skin/*.js; do ln -sf $(CURDIR)/$$f $(CONF)/$$(basename $$f); done
	@test -f $(CONF)/curseforge.headers || echo "CurseForge is off until you add your own key: see README"

clean:
	rm -f shim/alloyskin.so

.PHONY: install clean
